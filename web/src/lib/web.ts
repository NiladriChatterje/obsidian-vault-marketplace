/** Browser helpers that bridge DOM files to the shared (uri-based) upload API. */

/**
 * Object URL for a picked file. The extension is appended as a fragment so a
 * backend can infer the content type from the uri; the shim strips it again
 * before fetching.
 */
export function fileToUri(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const url = URL.createObjectURL(file);
  picked.set(url, file);
  return ext ? `${url}#.${ext}` : url;
}

const picked = new Map<string, File>();

/** The original File, so uploads can skip fetching the object URL back. */
export function fileFromUri(uri: string): File | undefined {
  return picked.get(uri.split('#')[0]);
}

/** Call once the upload is done: the object URL pins the whole file in memory. */
export function releaseUri(uri: string): void {
  const url = uri.split('#')[0];
  picked.delete(url);
  URL.revokeObjectURL(url);
}

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Base URL of this site, for showing the MCP endpoint. */
export function siteOrigin(): string {
  if (process.env.NEXT_PUBLIC_REDIRECT_ORIGIN) return process.env.NEXT_PUBLIC_REDIRECT_ORIGIN;
  return typeof location !== 'undefined' ? location.origin : '';
}
