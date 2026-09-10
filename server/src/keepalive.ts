/**
 * Free hosting tiers (Render, Fly, Railway) idle a web service out after a few
 * minutes without traffic, so the next buyer pays a cold start. Pinging our own
 * /health on a timer keeps the instance warm.
 *
 * Silent no-op unless the public URL points somewhere other than localhost, so
 * local runs and tests never ping anything. Set KEEP_AWAKE=off to disable it on
 * a paid instance that has no idle timeout.
 */
import type { FastifyBaseLogger } from 'fastify';
import { cfg } from './config.ts';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

/** Render idles at 15 minutes; stay under that with room for a slow request. */
const DEFAULT_MINUTES = 14;
const REQUEST_TIMEOUT_MS = 10_000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** Render exports its own public URL; fall back to the URL Razorpay already redirects to. */
function target(): string {
  return (env('KEEP_AWAKE_URL') || env('RENDER_EXTERNAL_URL') || cfg.apiUrl).replace(/\/$/, '');
}

function pingable(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) && !LOCAL_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Starts the keep-warm timer. Returns the interval so a caller (tests, a graceful
 * shutdown) can clear it; the timer is unref'd, so it never holds the process open.
 */
export function startKeepAwake(log: FastifyBaseLogger): NodeJS.Timeout | null {
  const base = target();
  if (env('KEEP_AWAKE') === 'off') return null;
  if (!pingable(base)) {
    log.info(`Keep-awake off: ${base || 'no public URL'} is not a remote http(s) address`);
    return null;
  }

  const minutes = Number(env('KEEP_AWAKE_MINUTES', String(DEFAULT_MINUTES))) || DEFAULT_MINUTES;
  const url = `${base}/health`;

  const ping = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Any answer proves the instance is awake; a bad status is the route's problem, not ours.
      log.debug(`Keep-awake ping ${res.status}`);
    } catch (e) {
      log.warn(`Keep-awake ping failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const timer = setInterval(ping, minutes * 60_000);
  timer.unref();
  log.info(`Keep-awake pinging ${url} every ${minutes} min`);
  return timer;
}
