/**
 * Is this zip actually an Obsidian vault? Answered in the browser, before the upload.
 *
 * The server decides the same thing in `server/src/catalog/markdown.ts` and
 * `routes/catalog.ts`, and that remains the authority. This exists so a seller does not
 * wait out a 70 MB upload to be told no, and so the reason lands next to the button
 * instead of arriving as a bare 400.
 *
 * The rules are deliberately identical, so keep them in step: a vault needs at least one
 * readable note, and everything else in the zip is kept as an attachment.
 */
import { unzipSync } from 'fflate';

/** Notes. Anything else in the zip becomes an attachment and travels with the vault. */
const MARKDOWN_EXT = /\.(md|markdown|canvas)$/i;

/** Junk that is in the archive but not in the vault. `__MACOSX` is what Mac zipping adds. */
function isIgnoredPath(path: string): boolean {
  return /(^|\/)(\.trash|__MACOSX|node_modules|\.git)\//.test(path) || /(^|\/)\.DS_Store$/.test(path) || path.endsWith('/');
}

/** Zips of a vault folder usually have one shared top folder; the server strips it too. */
function stripCommonRoot(paths: string[]): (p: string) => string {
  const first = paths[0]?.split('/')[0];
  const shared = !!first && paths.length > 0 && paths.every((p) => p.startsWith(`${first}/`));
  return shared ? (p) => p.slice(first!.length + 1) : (p) => p;
}

/** Per-note cap at ingest. A larger markdown file is skipped rather than stored. */
const MAX_NOTE_BYTES = 2 * 1024 * 1024;

/** The same cap for everything that is not a note. Mirrors MAX_ATTACHMENT_BYTES on the server. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface VaultZipCheck {
  ok: boolean;
  noteCount: number;
  attachmentCount: number;
  /**
   * What the vault will occupy once stored: the unpacked bytes of the files that survive the
   * rules above, which is what the seller's storage quota counts. Not the size of the zip.
   */
  sizeBytes: number;
  /** Why it was refused, phrased for the seller. Only set when ok is false. */
  reason?: string;
}

export async function inspectVaultZip(file: File): Promise<VaultZipCheck> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, noteCount: 0, attachmentCount: 0, sizeBytes: 0, reason: 'That file is not a valid zip archive.' };
  }

  const paths = Object.keys(entries);
  if (!paths.length) return { ok: false, noteCount: 0, attachmentCount: 0, sizeBytes: 0, reason: 'That zip is empty.' };

  const strip = stripCommonRoot(paths);
  let noteCount = 0;
  let attachmentCount = 0;
  let sizeBytes = 0;
  let ignoredNotes = 0;
  let oversizeNotes = 0;

  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/') || data.byteLength === 0) continue;
    const path = strip(rawPath);
    if (!path) continue;
    if (isIgnoredPath(path)) {
      if (MARKDOWN_EXT.test(path)) ignoredNotes++;
      continue;
    }
    if (!MARKDOWN_EXT.test(path)) {
      if (data.byteLength > MAX_ATTACHMENT_BYTES) continue;
      attachmentCount++;
      sizeBytes += data.byteLength;
      continue;
    }
    if (data.byteLength > MAX_NOTE_BYTES) {
      oversizeNotes++;
      continue;
    }
    noteCount++;
    sizeBytes += data.byteLength;
  }

  if (noteCount > 0) return { ok: true, noteCount, attachmentCount, sizeBytes };

  // No usable notes. Say which of the three ways it failed, because the fix differs.
  const reason = ignoredNotes
    ? 'The only notes in that zip are inside a folder we skip, such as __MACOSX or .trash. Zip the vault folder itself rather than compressing it from the Finder sidebar.'
    : oversizeNotes
      ? 'Every note in that zip is over 2 MB, which is larger than a note can be. Check you zipped a vault and not an export.'
      : 'That zip has no notes in it. An Obsidian vault needs at least one .md, .markdown or .canvas file; images, PDFs and your .obsidian config can come along with them.';
  return { ok: false, noteCount: 0, attachmentCount, sizeBytes: 0, reason };
}
