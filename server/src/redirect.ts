import { cfg } from './config.ts';

/**
 * Validates where the buyer may be sent after checkout. Accepts an http(s)
 * origin (the site) or a custom scheme like `vaultmarket:/` (the app).
 */
export function resolveReturnOrigin(input: unknown): string {
  const origin = typeof input === 'string' && input ? input : 'vaultmarket:/';
  if (/^https?:\/\//.test(origin)) {
    const clean = origin.replace(/\/$/, '');
    if (cfg.allowedRedirectOrigins.length && !cfg.allowedRedirectOrigins.includes(clean)) {
      throw new Error('Redirect origin is not allowed');
    }
    return clean;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/$/.test(origin)) throw new Error('Invalid redirect origin');
  return origin;
}

/** Full URL for a path + params on the return origin (`vaultmarket:/` + `/checkout-result` = `vaultmarket://checkout-result`). */
export function returnUrl(origin: string, path: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `${origin}${path}${qs.size ? `?${qs}` : ''}`;
}
