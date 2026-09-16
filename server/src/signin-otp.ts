/**
 * The second step of signing in: a six-digit code, emailed by Brevo.
 *
 * The point of this module is that the password alone leaves nobody signed in. The browser
 * never calls `signInWithPassword` — if it did, a session would exist the moment the password
 * was accepted and the code that follows would be decoration, skippable from the console. So
 * the password is checked here, on a throwaway client whose session is revoked immediately,
 * and the caller gets back nothing but a challenge id.
 *
 * When the code checks out, a session is minted fresh through Supabase's admin API
 * (`generateLink` returns a `hashed_token` the browser exchanges for a real session). That is
 * why the stored challenge holds no tokens: there is never a session waiting to be stolen.
 *
 * Six digits is not much entropy. What makes it safe is everything around it: a five-minute
 * life, three attempts, single use, a cap on how often one address may ask, and the same
 * sentence back whatever went wrong.
 *
 * All of it lives in Redis rather than a table. A challenge is worthless five minutes after
 * it is made, so keeping it somewhere that forgets on its own means there is no row to expire,
 * nothing to sweep, and no "expired but still present" state to reason about: a key that is
 * gone is a challenge that is over.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { cfg } from './config.ts';
import { EMAIL_ENABLED, sendEmail } from './email.ts';
import { redis } from './redis.ts';
import { admin } from './supabase.ts';

const CODE_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 3;
/** How many codes one address may ask for per hour, however good the password is. */
const MAX_CODES_PER_HOUR = 5;

const challengeKey = (id: string) => `signin:challenge:${id}`;
const rateKey = (email: string) => `signin:rate:${email}`;

/**
 * Deliberately one sentence for every failure: wrong code, expired code, already-used code,
 * unknown challenge, too many tries. Which of those it was only helps someone guessing.
 */
const BAD_CODE = 'That code is wrong or has expired. Ask for a new one.';

export class SignInError extends Error {
  // Declared rather than a constructor parameter property: the server runs on Node's type
  // stripping, which only erases syntax that leaves no runtime behaviour behind.
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** randomInt, not Math.random: this is the whole secret and it has only a million values. */
function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Salted with the challenge id so the same code issued twice does not hash alike, which keeps
 * the store from being a lookup table of a million values. A slow hash would be better in
 * principle, but the guess ceiling here is three, not billions, so the attempt cap is doing
 * the work that key stretching would do elsewhere.
 */
function hashCode(challengeId: string, code: string): string {
  return crypto.createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function body(code: string): { html: string; text: string } {
  const html = `
    <p>Your sign-in code for Vault Market:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
    <p>It works once and expires in ${CODE_TTL_SECONDS / 60} minutes.</p>
    <p style="color:#666">If you did not just try to sign in, someone has your password. Change it,
    and know that the code above is the only thing standing between them and your account.</p>
  `;
  const text = `Your sign-in code for Vault Market: ${code}\n\nIt works once and expires in ${CODE_TTL_SECONDS / 60} minutes.\n\nIf you did not just try to sign in, someone has your password. Change it.`;
  return { html, text };
}

export interface StartedChallenge {
  challengeId: string;
  expiresInSeconds: number;
}

/**
 * Checks the password, then emails a code. Returns the challenge id, which is useless on its
 * own: it names a key, it does not authorise anything.
 */
export async function startSignIn(email: string, password: string, log?: FastifyBaseLogger): Promise<StartedChallenge> {
  if (!cfg.supabase.anonKey) throw new SignInError('Sign-in is not configured on the server.', 500);
  // Without a mailer there is no second step, and letting the password alone through would
  // quietly turn two-factor sign-in back into one-factor.
  if (!EMAIL_ENABLED) throw new SignInError('Sign-in codes cannot be sent: the server has no mail provider configured.', 503);

  const address = email.trim().toLowerCase();

  // A throwaway client, never the shared one: this session exists for as long as it takes to
  // learn whether the password was right, and is then revoked.
  const probe = createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email: address, password });
  if (error || !data.user) {
    // Supabase's own limiter has already counted this attempt, so nothing more to do here.
    const message = /email not confirmed/i.test(error?.message ?? '')
      ? 'Confirm your email first — open the link we sent when you signed up.'
      : 'That email and password do not match an account.';
    throw new SignInError(message, 401);
  }
  const userId = data.user.id;
  await probe.auth.signOut().catch(() => {});

  const store = await redis();

  // Right password or not, one address only gets so many codes an hour. The counter is a key
  // with an hour on it, so the window slides shut by itself.
  const asked = await store.incr(rateKey(address));
  if (asked === 1) await store.expire(rateKey(address), 60 * 60);
  if (asked > MAX_CODES_PER_HOUR) {
    throw new SignInError('Too many sign-in codes requested. Wait an hour and try again.', 429);
  }

  const code = newCode();
  const challengeId = crypto.randomUUID();
  // The id is the salt, so it has to be settled before the hash is.
  await store.hSet(challengeKey(challengeId), { userId, email: address, codeHash: hashCode(challengeId, code), attempts: 0 });
  await store.expire(challengeKey(challengeId), CODE_TTL_SECONDS);

  const { html, text } = body(code);
  const sent = await sendEmail({ to: address, subject: `${code} is your Vault Market sign-in code`, html, text, tag: 'signin-code' }, log);
  if (!sent) {
    // Nothing is going to arrive, so do not leave a live challenge behind for it.
    await store.del(challengeKey(challengeId));
    throw new SignInError('We could not send your sign-in code. Try again in a moment.', 502);
  }

  return { challengeId, expiresInSeconds: CODE_TTL_SECONDS };
}

/**
 * Checks a code and, if it holds up, returns a one-time `token_hash` the browser exchanges
 * with Supabase for a real session. Nothing here is a session itself.
 */
export async function verifySignIn(challengeId: string, code: string): Promise<{ tokenHash: string }> {
  const digits = code.trim();
  if (!/^\d{6}$/.test(digits)) throw new SignInError(BAD_CODE, 400);

  const store = await redis();
  const key = challengeKey(challengeId);
  const row = await store.hGetAll(key);
  // No key means expired, already used, or never issued -- all the same thing to the caller.
  if (!row.codeHash) throw new SignInError(BAD_CODE, 400);

  // Counted before the comparison, so a connection dropped mid-check costs the attempt rather
  // than handing out a free one. Incrementing a field leaves the key's expiry alone.
  const attempts = await store.hIncrBy(key, 'attempts', 1);
  if (attempts > MAX_ATTEMPTS) {
    await store.del(key);
    throw new SignInError(BAD_CODE, 400);
  }

  if (!sameHash(row.codeHash, hashCode(challengeId, digits))) throw new SignInError(BAD_CODE, 400);

  // Single use, and the delete is what enforces it: whoever removes the key is the one who
  // gets a session, so a replay arriving at the same instant finds nothing to spend.
  if (!(await store.del(key))) throw new SignInError(BAD_CODE, 400);

  const { data: link, error: linkError } = await admin().auth.admin.generateLink({ type: 'magiclink', email: row.email });
  if (linkError || !link.properties?.hashed_token) {
    throw new SignInError(linkError?.message ?? 'Could not complete sign-in.', 500);
  }
  return { tokenHash: link.properties.hashed_token };
}
