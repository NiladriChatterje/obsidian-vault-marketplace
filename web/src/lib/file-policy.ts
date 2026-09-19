/**
 * What may be inside a vault: .md, .canvas, .base, .json, .yaml/.yml, .toml and .txt, and
 * nothing else. Browser copy of server/src/catalog/file-policy.ts, which is the authority;
 * this one lets the picker say no before a 70 MB upload. Keep the two in step.
 *
 * The refusal is decided from the bytes as well as the name: a PNG renamed `image.png.md`
 * still starts with the PNG signature and still is not text.
 */

/** The whole list. A file with no extension, or any other one, is refused by name. */
export const ALLOWED_EXT = /\.(md|canvas|base|json|ya?ml|toml|txt)$/i;
export const ALLOWED_LIST = '.md, .canvas, .base, .json, .yaml/.yml, .toml and .txt';

// Only signatures a real note could not start with; formats that open with plain letters
// ("BM", "MZ", "ID3") are left to the text check, which catches them anyway.
const SIGNATURES: { name: string; bytes: number[]; at?: number }[] = [
  { name: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'JPEG image', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  { name: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { name: 'WebP image', bytes: [0x57, 0x45, 0x42, 0x50], at: 8 },
  { name: 'TIFF image', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'TIFF image', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
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

export function binarySignature(data: Uint8Array): string | null {
  for (const s of SIGNATURES) if (startsWith(data, s.bytes, s.at)) return s.name;
  return null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function isUtf8Text(data: Uint8Array): boolean {
  for (let i = 0; i < data.byteLength; i++) if (data[i] === 0) return false;
  try {
    utf8.decode(data);
    return true;
  } catch {
    return false;
  }
}

/** Why this file may not be in a vault, phrased for the seller, or null when it may. */
export function whyRefused(path: string, data: Uint8Array): string | null {
  if (!ALLOWED_EXT.test(path)) return `is not a file type a vault may hold (${ALLOWED_LIST})`;
  const sig = binarySignature(data);
  if (sig) return `is a ${sig} whatever its name says; a vault may hold only text files (${ALLOWED_LIST})`;
  if (!isUtf8Text(data)) return `is not a text file (it is binary, or not UTF-8); a vault may hold only text files (${ALLOWED_LIST})`;
  return null;
}
