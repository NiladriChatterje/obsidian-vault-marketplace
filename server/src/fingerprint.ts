/**
 * Per-buyer fingerprints, stamped into notes on their way to the Obsidian plugin.
 *
 * A vault is markdown. Whatever a buyer can read, a buyer can repost, and no amount of gating
 * changes that. What a fingerprint buys is not prevention but *attribution*: a leaked copy can
 * be traced back to the account it was served to, which is what makes a seller trust the
 * platform enough to publish here exclusively.
 *
 * The mark is a 64-bit HMAC over (vault, buyer) written as zero-width characters appended to
 * the note. Nothing is stored: the same pair always produces the same mark, so identifying a
 * leak means walking that vault's purchasers and comparing (see traceLeak).
 *
 * Two properties this file must never lose:
 *
 *   Deterministic. The plugin's three-way merge compares the hash of what is on disk against
 *   the hash it recorded at install. A mark that changed between two calls would make every
 *   note look edited. Same vault + same buyer + same secret = byte-identical output, always.
 *
 *   Invisible and inert. Zero-width characters render as nothing in preview and in source
 *   mode, survive copy-paste, and carry no markdown meaning. They go at the end of the file,
 *   never inside frontmatter, a link or a code fence, so nothing a note does can break.
 *
 * Only `.md` is stamped. `.canvas` and the attachment types are JSON/YAML/TOML, where a stray
 * character is not invisible at all — it is a parse error.
 *
 * Off unless FINGERPRINT_SECRET is set, and then the secret must never be rotated: a new secret
 * is a new mark on every note, which every installed vault would see as an update.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cfg } from './config.ts';

export const FINGERPRINT_ENABLED = !!cfg.fingerprintSecret;

/** Zero-width space = 0, zero-width non-joiner = 1, word joiner fences the block. */
const ZERO = '​';
const ONE = '‌';
const FENCE = '⁠';

/** 64 bits: enough that two buyers of one vault will not collide, short enough to stay cheap. */
const BITS = 64;

/** A block anywhere in the text, for reading a mark back out of a leaked note. */
const BLOCK = new RegExp(`${FENCE}[${ZERO}${ONE}]*${FENCE}`, 'g');

/**
 * A block exactly where this module puts one, for taking it off again. Matching the trailer
 * rather than any block is what makes stamping idempotent down to the byte: the newline that
 * carries the block is removed with it, so re-stamping cannot grow the file a line at a time.
 */
const TRAILER = new RegExp(`\\n${FENCE}[${ZERO}${ONE}]*${FENCE}\\n?$`);

/** Notes are stamped; .canvas and the attachment types are structured text and are not. */
export function isStampable(path: string): boolean {
  return /\.md$/i.test(path);
}

/** The mark for one buyer of one vault, as hex. Same inputs, same output, for ever. */
export function markFor(vaultId: string, userId: string): string {
  return createHmac('sha256', cfg.fingerprintSecret).update(`${vaultId}:${userId}`).digest('hex').slice(0, BITS / 4);
}

function encode(mark: string): string {
  const bits = [...mark].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  return FENCE + [...bits].map((b) => (b === '1' ? ONE : ZERO)).join('') + FENCE;
}

function decode(block: string): string | null {
  const bits = [...block.replace(new RegExp(FENCE, 'g'), '')].map((c) => (c === ONE ? '1' : '0')).join('');
  if (bits.length !== BITS) return null;
  return (bits.match(/.{4}/g) ?? []).map((nibble) => parseInt(nibble, 2).toString(16)).join('');
}

/**
 * The note as this buyer receives it. Any existing block is stripped first, so stamping is
 * idempotent and a re-serve never accumulates marks.
 */
export function stampNote(body: string, mark: string): string {
  const clean = body.replace(TRAILER, '');
  return `${clean.endsWith('\n') ? clean : `${clean}\n`}${encode(mark)}\n`;
}

/** The mark in a leaked note, or null when there is none to find. */
export function extractMark(text: string): string | null {
  const blocks = text.match(BLOCK);
  return blocks?.length ? decode(blocks[blocks.length - 1]) : null;
}

/**
 * Which of these accounts a leaked note was served to. The mark is not a secret to compare in
 * constant time against an attacker's guess, but it is compared against account ids, so the
 * comparison is done the careful way regardless.
 */
export function traceLeak(text: string, vaultId: string, userIds: string[]): string | null {
  const found = extractMark(text);
  if (!found) return null;
  const wanted = Buffer.from(found, 'hex');
  for (const userId of userIds) {
    const candidate = Buffer.from(markFor(vaultId, userId), 'hex');
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) return userId;
  }
  return null;
}
