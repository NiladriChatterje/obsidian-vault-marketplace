/**
 * A small clamd client: the INSTREAM protocol over a TCP socket, and nothing else.
 *
 * clamd lives in this same container, so this talks to it on the loopback address. The bytes
 * are forwarded as they arrive rather than collected first, which is why a 70 MB vault does
 * not have to fit in the scanner's memory.
 */
import net from 'node:net';

const HOST = process.env.CLAMD_HOST || '127.0.0.1';
const PORT = Number(process.env.CLAMD_PORT || 3310);
/** A 70 MB archive of many small files is the slow case, and a cold daemon is slower still. */
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS || 120_000);
/** Chunk size on the wire. Anything larger from the caller is split; smaller is sent as it came. */
const CHUNK_BYTES = 64 * 1024;

export interface ScanResult {
  clean: boolean;
  /** ClamAV's name for what it found, such as `Win.Trojan.Agent-1234`. Only set when not clean. */
  signature?: string;
}

/** Is clamd up and finished loading its signatures? Used by `GET /health`. */
export function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    socket.setTimeout(5_000);
    let reply = '';
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (d) => {
      reply += d.toString('latin1');
    });
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => resolve(reply.includes('PONG')));
  });
}

/**
 * Streams `source` past clamd and resolves with its verdict.
 *
 * Rejects when the daemon could not be reached, timed out, answered with something that is
 * neither a verdict nor silence, or when `source` itself failed. A rejection means "not
 * scanned", which callers must not confuse with "clean".
 */
export function scanStream(source: AsyncIterable<Uint8Array>): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    socket.setTimeout(TIMEOUT_MS);

    let reply = '';
    /** The upload itself failing (too large, caller gone) outranks anything clamd says after. */
    let sourceFailure: Error | null = null;
    let socketFailure: Error | null = null;
    const answer = () => reply.replace(/\0/g, '').trim();

    /** clamd's verdict, once it has arrived in full. Null while it has said nothing usable. */
    const verdict = (): ScanResult | null => {
      const found = /^stream:\s+(.+)\s+FOUND$/.exec(answer());
      if (found) return { clean: false, signature: found[1] };
      return /^stream:\s+OK$/.test(answer()) ? { clean: true } : null;
    };

    socket.on('data', (d) => {
      reply += d.toString('latin1');
    });
    // Every ending arrives as 'close', including after an error, so the verdict is read in one
    // place. It matters: on a hit clamd answers and hangs up while we are still writing, which
    // would otherwise be a race between its verdict and our own broken pipe.
    socket.on('error', (e) => {
      socketFailure = e;
    });
    socket.on('timeout', () => {
      socketFailure = new Error(`clamd did not answer within ${TIMEOUT_MS / 1000}s`);
      socket.destroy();
    });
    socket.on('close', () => {
      const v = verdict();
      if (v) return resolve(v);
      // No verdict: the upload's own failure first, then clamd's complaint if it made one
      // (most often the stream length limit), then whatever the socket reported.
      if (sourceFailure) return reject(sourceFailure);
      reject(answer() ? new Error(answer()) : (socketFailure ?? new Error('clamd closed the connection without a verdict')));
    });

    socket.on('connect', () => {
      // Every write waits for the socket to drain, so a large upload is not queued into the
      // send buffer faster than clamd works through it.
      const write = (b: Buffer) =>
        new Promise<void>((res, rej) => {
          if (socket.closed) rej(new Error('clamd closed the connection'));
          else if (socket.write(b)) res();
          else socket.once('drain', res);
        });

      /** One framed chunk: a 4-byte big-endian length, then the bytes. */
      const send = async (chunk: Uint8Array) => {
        const header = Buffer.alloc(4); // a fresh one each time: it is still queued when write() returns
        header.writeUInt32BE(chunk.byteLength, 0);
        await write(header);
        await write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      };

      void (async () => {
        try {
          await write(Buffer.from('zINSTREAM\0'));
          for await (const chunk of source) {
            try {
              for (let i = 0; i < chunk.byteLength; i += CHUNK_BYTES) {
                await send(chunk.subarray(i, Math.min(i + CHUNK_BYTES, chunk.byteLength)));
              }
            } catch {
              // clamd hung up early, which it does as soon as it has seen enough. Its reason is
              // already on its way, so let 'close' settle this rather than guessing here.
              return;
            }
          }
          await write(Buffer.alloc(4)).catch(() => {}); // a zero-length chunk ends the stream
        } catch (e) {
          // The upload failed, not the scan: too large, or the caller went away mid-body.
          sourceFailure = e instanceof Error ? e : new Error(String(e));
          socket.destroy();
        }
      })();
    });
  });
}
