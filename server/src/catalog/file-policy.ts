/**
 * What may be inside a vault: a short list of text formats, nothing else.
 *
 *   .md          notes, instructions, knowledge
 *   .canvas      Obsidian canvases (visual graphs, workflows)
 *   .base        Obsidian Bases
 *   .json        structured configuration and metadata
 *   .yaml .yml   configuration, agent definitions
 *   .toml        configuration
 *   .txt         raw text, prompts, logs
 *
 * Everything else, images first of all, is refused, and the refusal is decided from the
 * bytes as well as the name. A PNG renamed `image.png.md` passes the name check but still
 * starts with the PNG signature and still is not text, so it is caught the same way a PNG
 * named `image.png` is. Three checks, in order, and the first to fail names the reason:
 *
 *   1. the name: an extension outside the list is refused outright, whatever the bytes;
 *   2. the bytes: a known binary signature (PNG, JPEG, PDF, ZIP, EXE ...) is refused;
 *   3. the bytes: anything that is not valid UTF-8 text without NUL bytes is refused.
 *
 * Mirrored in web/src/lib/file-policy.ts so the browser can say no before the upload; this
 * copy is the authority and runs on every path a zip can take (inline and queued).
 */

/** The whole list. A file with no extension, or any other one, is refused by name. */
export const ALLOWED_EXT = /\.(md|canvas|base|json|ya?ml|toml|txt)$/i;
export const ALLOWED_LIST = '.md, .canvas, .base, .json, .yaml/.yml, .toml and .txt';

/**
 * Leading bytes of formats that are never text, however the file is named. Only signatures
 * a real note could not start with are listed: "BM", "MZ", "ID3" and the like are plain
 * letters a sentence may open with, so those formats are left to the text check below, which
 * catches them anyway (they all carry NUL bytes within their first few dozen).
 */
const SIGNATURES: { name: string; bytes: number[]; at?: number }[] = [
  { name: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'JPEG image', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  { name: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { name: 'WebP image', bytes: [0x57, 0x45, 0x42, 0x50], at: 8 },
  { name: 'TIFF image', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'TIFF image', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { name: 'zip archive', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'gzip archive', bytes: [0x1f, 0x8b] },
  { name: '7z archive', bytes: [0x37, 0x7a, 0xbc, 0xaf] },
  { name: 'RAR archive', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a] },
  { name: 'ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Mach-O executable', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: 'Java class', bytes: [0xca, 0xfe, 0xba, 0xbe] },
];

function startsWith(data: Uint8Array, bytes: number[], at = 0): boolean {
  if (data.byteLength < at + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (data[at + i] !== bytes[i]) return false;
  return true;
}

/** The binary format these bytes announce themselves as, or null. */
export function binarySignature(data: Uint8Array): string | null {
  for (const s of SIGNATURES) if (startsWith(data, s.bytes, s.at)) return s.name;
  return null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Valid UTF-8 with no NUL bytes. UTF-16 files fail here; Obsidian writes UTF-8. */
export function isUtf8Text(data: Uint8Array): boolean {
  for (let i = 0; i < data.byteLength; i++) if (data[i] === 0) return false;
  try {
    utf8.decode(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why this file may not be in a vault, phrased for the seller, or null when it may.
 * `path` is the path inside the vault, after the common root is stripped.
 */
export function whyRefused(path: string, data: Uint8Array): string | null {
  if (!ALLOWED_EXT.test(path)) return `is not a file type a vault may hold (${ALLOWED_LIST})`;
  const sig = binarySignature(data);
  if (sig) return `is a ${sig} whatever its name says; a vault may hold only text files (${ALLOWED_LIST})`;
  if (!isUtf8Text(data)) return `is not a text file (it is binary, or not UTF-8); a vault may hold only text files (${ALLOWED_LIST})`;
  return null;
}

/* ---------- covers: the one place an image is wanted, and it had better really be one ---------- */

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif';

/** What image these bytes are, from their signature, or null. The declared MIME type is not trusted. */
export function imageKind(data: Uint8Array): ImageKind | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  return null;
}
