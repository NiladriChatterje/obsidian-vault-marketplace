/** Browser helpers that bridge DOM files to the shared (uri-based) upload API. */

/**
 * Object URL for a picked file. The extension is appended as a fragment so
 * `extFromUri` in the shared backend can infer the content type; the shim
 * strips it again before fetching.
 */
export function fileToUri(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const url = URL.createObjectURL(file);
  return ext ? `${url}#.${ext}` : url;
}

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Base URL of this site, for showing the MCP endpoint. */
export function siteOrigin(): string {
  if (process.env.EXPO_PUBLIC_REDIRECT_ORIGIN) return process.env.EXPO_PUBLIC_REDIRECT_ORIGIN;
  return typeof location !== 'undefined' ? location.origin : '';
}
