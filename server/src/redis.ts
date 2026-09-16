/**
 * Redis, used for the one thing in this server that is deliberately short-lived: the sign-in
 * challenge behind an emailed code (see signin-otp.ts).
 *
 * A code that lives five minutes and dies on first use is a poor fit for a table — every row
 * written is a row to expire and sweep. Redis expires it for us, so nothing accumulates and
 * no cleanup path has to exist.
 *
 * One lazily-opened connection, shared. There is no fallback if Redis is down: sign-in fails
 * closed, which is the right way round, since the alternative is quietly letting a password
 * through on its own.
 */
import { createClient, type RedisClientType } from 'redis';
import { cfg } from './config.ts';

let client: RedisClientType | null = null;
let opening: Promise<RedisClientType> | null = null;

export const REDIS_ENABLED = !!cfg.redisUrl;

export async function redis(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (!cfg.redisUrl) throw new Error('REDIS_URL is not set: sign-in codes have nowhere to live.');
  // Concurrent callers during startup share one connect rather than opening several.
  opening ??= (async () => {
    const c = createClient({ url: cfg.redisUrl }) as RedisClientType;
    // Without a listener an emitted error is an unhandled exception that takes the process
    // down; a dropped connection should only fail the request that needed it.
    c.on('error', () => {});
    await c.connect();
    client = c;
    opening = null;
    return c;
  })();
  return opening;
}
