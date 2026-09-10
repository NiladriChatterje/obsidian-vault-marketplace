/**
 * Transactional email through Brevo's HTTP API (POST /v3/smtp/email).
 *
 * Nothing sent from here is on a critical path: a receipt that fails to send must never
 * fail the payment that triggered it, so `sendEmail` resolves false and logs instead of
 * throwing. With BREVO_API_KEY unset it is a silent no-op, which keeps local runs and the
 * demo from mailing anyone.
 *
 * Note this is separate from the mail Supabase sends for sign-up confirmations and password
 * resets: those are configured as SMTP in the Supabase dashboard (Brevo can serve both, but
 * the dashboard needs the SMTP credentials, not this API key).
 *
 * The sender must be a verified sender or domain in Brevo, otherwise every send comes back
 * 400 "sender not valid".
 */
import type { FastifyBaseLogger } from 'fastify';
import { cfg } from './config.ts';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10_000;

/** False when no API key is configured; callers can skip building a message body. */
export const EMAIL_ENABLED = !!cfg.brevo.apiKey;

export interface EmailMessage {
  /** Recipient address, or address plus display name. */
  to: string | { email: string; name?: string };
  subject: string;
  html: string;
  /** Plain-text alternative. Worth sending: some clients and most spam filters prefer it. */
  text?: string;
  /** Defaults to the sender address. */
  replyTo?: string;
  /** Brevo tag, for filtering sends in their dashboard (e.g. 'receipt'). */
  tag?: string;
}

/** Resolves true when Brevo accepted the message. Never throws. */
export async function sendEmail(msg: EmailMessage, log?: FastifyBaseLogger): Promise<boolean> {
  if (!EMAIL_ENABLED) {
    log?.debug({ subject: msg.subject }, 'Email skipped: BREVO_API_KEY is not set');
    return false;
  }
  const to = typeof msg.to === 'string' ? { email: msg.to } : msg.to;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': cfg.brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.brevo.senderEmail, name: cfg.brevo.senderName },
        to: [to],
        replyTo: { email: msg.replyTo ?? cfg.brevo.senderEmail },
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        tags: msg.tag ? [msg.tag] : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Brevo explains the refusal in the body (unverified sender, spent credits, bad key).
      const body = await res.text().catch(() => '');
      log?.error({ status: res.status, body: body.slice(0, 500), to: to.email }, 'Brevo rejected the email');
      return false;
    }
    return true;
  } catch (e) {
    log?.error({ err: e, to: to.email }, 'Could not reach Brevo');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
