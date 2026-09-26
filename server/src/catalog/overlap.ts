/**
 * Is this upload somebody else's vault, bought and re-listed?
 *
 * A thief edits a few notes, not three hundred, so the check is per note: normalise each one,
 * hash it, and ask Postgres which listings by *other* sellers already hold those hashes
 * (catalog_bundle_overlap, 0021). The normalisation is what makes it hold up. The stored
 * `hash` is of the bytes as shipped, and one whitespace change defeats it; this one drops the
 * frontmatter, every zero-width character (our own fingerprint among them), case, whitespace
 * and punctuation, so a reflow, a formatter pass or a retyped frontmatter block all hash the
 * same. Only rewriting the prose changes it, and rewriting three hundred notes is writing a vault.
 *
 * Cost: one sha256 per note, done once and stored on the row (ingestBundle takes the map so it
 * is not computed twice), and one round trip with every hash in one array. The scanner's 8–15 s
 * per zip is the ingest's cost; this adds milliseconds.
 *
 * The verdict is a refusal, not a queue: at the threshold below the overlap is a copy, and a
 * seller who really owns both accounts is told to upload from the one that lists it. When the
 * copied notes still carry a buyer's fingerprint, the leak is traced on the spot and logged.
 */
import { createHash } from 'node:crypto';
import { extractMark, FINGERPRINT_ENABLED, traceLeak } from '../fingerprint.ts';
import { admin } from '../supabase.ts';
import type { BundleFile } from './index.ts';
import { MARKDOWN_EXT, isIgnoredPath, parseFrontmatter, stripCommonRoot } from './markdown.ts';

/** Below this many letters and digits a note is a stub or a template, and two of them colliding means nothing. */
const MIN_CHARS = 80;
/** Share of the upload's notes found in one other listing that makes it a copy, and the floor so a two-note vault cannot trip it. */
const COPY_RATIO = 0.6;
const MIN_MATCHED = 3;

/** Normalised content hash of one note, or null when there is too little content to compare. */
export function textHash(content: string): string | null {
  const text = parseFrontmatter(content)
    .body.replace(/[​-‍⁠﻿]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (text.length < MIN_CHARS) return null;
  return createHash('sha256').update(text).digest('hex');
}

export interface CopiedVault {
  vaultId: string;
  title: string;
  sellerId: string;
  matched: number;
  total: number;
  /** The buyer the copied notes were served to, when they still carry a fingerprint. */
  leakedBy: string | null;
}

/**
 * The listing this upload copies, or null when it copies nobody's. `hashes` is what
 * `noteTextHashes` produced for these files, and what ingest will store.
 */
export async function findCopiedVault(files: BundleFile[], hashes: Map<string, string | null>, uploaderId: string): Promise<CopiedVault | null> {
  const distinct = [...new Set([...hashes.values()].filter((h): h is string => !!h))];
  if (distinct.length < MIN_MATCHED) return null;
  const { data, error } = await admin().rpc('catalog_bundle_overlap', { p_uploader: uploaderId, p_hashes: distinct, p_limit: 1 });
  if (error) throw new Error(error.message);
  const top = (data as { vault_id: string; title: string; seller_id: string; matched: number }[] | null)?.[0];
  if (!top || top.matched < MIN_MATCHED || top.matched < distinct.length * COPY_RATIO) return null;

  // Proof, when there is any: a mark in the copied notes names the account that leaked them.
  // Only walked on a refusal, so it costs nothing on the uploads that go through.
  let leakedBy: string | null = null;
  if (FINGERPRINT_ENABLED) {
    const decoder = new TextDecoder('utf-8');
    const strip = stripCommonRoot(files.map((f) => f.path));
    const marked = files.find((f) => {
      const path = strip(f.path);
      return path && !isIgnoredPath(path) && /\.md$/i.test(path) && extractMark(decoder.decode(f.data));
    });
    if (marked) {
      const { data: buyers } = await admin().from('purchases').select('buyer_id').eq('vault_id', top.vault_id);
      leakedBy = traceLeak(decoder.decode(marked.data), top.vault_id, (buyers ?? []).map((b) => b.buyer_id as string));
    }
  }
  return { vaultId: top.vault_id, title: top.title, sellerId: top.seller_id, matched: top.matched, total: distinct.length, leakedBy };
}

/** Normalised hash per stored note path, keyed the way ingestBundle keys its rows. */
export function noteTextHashes(files: BundleFile[]): Map<string, string | null> {
  const strip = stripCommonRoot(files.map((f) => f.path));
  const decoder = new TextDecoder('utf-8');
  const out = new Map<string, string | null>();
  for (const file of files) {
    const path = strip(file.path);
    if (!path || isIgnoredPath(path) || !MARKDOWN_EXT.test(path)) continue;
    out.set(path, textHash(decoder.decode(file.data)));
  }
  return out;
}
