/**
 * Watches seller balances so nobody has to remember to.
 *
 * Paying sellers is the one part of the marketplace that no provider does for us: Dodo is
 * the merchant of record, so it settles one amount to the platform and never pays a creator.
 * Someone therefore has to notice when a seller is owed enough to be worth a transfer. Left
 * to a human that means opening /admin/payouts on a hunch, which is exactly the sort of
 * chore that gets skipped until a seller writes in asking where their money is.
 *
 * So this checks on a timer and mails the operator only when there is something to do. A
 * balance qualifies when sellerBalances() calls it `payable`, which already means both of
 * the things that matter:
 *
 *   - cleared: past the buyer's reversal window, so sending it cannot strand us
 *   - above threshold: worth more than roughly 15x what the transfer itself costs, which is
 *     derived per region, since a domestic transfer is cheap and a SWIFT one is not
 *
 * Nothing here moves money or changes a balance. It reads, and it writes an email.
 *
 * Silent unless PAYOUT_WATCH_EMAIL (or a Brevo sender) is configured, so local runs and
 * tests never mail anyone. Set PAYOUT_WATCH=off to disable it outright.
 */
import type { FastifyBaseLogger } from 'fastify';
import { IS_DEMO, cfg } from './config.ts';
import { EMAIL_ENABLED, sendEmail } from './email.ts';
import { pendingPayoutRuns, preparePayoutRuns, runsToCsv } from './payout-ledger.ts';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

/** Once a day. Payout thresholds move slowly; checking more often would only mail more. */
const DEFAULT_HOURS = 24;

/** Minor units to a readable amount, e.g. 41908 + INR -> "INR 419.08". */
function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

/**
 * Totals are per currency. Sellers are paid in their own, so adding a rupee balance to a
 * euro one would produce a number that means nothing.
 */
type Run = Record<string, any>;

/**
 * Totals are per currency. Sellers are paid in their own, so adding a rupee balance to a
 * euro one would produce a number that means nothing.
 */
function subjectFor(runs: Run[]): string {
  const totals = new Map<string, number>();
  for (const r of runs) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount_cents);
  const who = runs.length === 1 ? '1 seller' : `${runs.length} sellers`;
  return `Payouts due: ${who}, ${[...totals].map(([cur, n]) => money(n, cur)).join(' + ')}`;
}

/** Whole days a run has been waiting for its transfer. */
function waitingDays(run: Run): number {
  return Math.floor((Date.now() - new Date(run.prepared_at).getTime()) / 86_400_000);
}

function bodyFor(runs: Run[], adminUrl: string): { html: string; text: string } {
  const rows = runs.map((r) => {
    const days = waitingDays(r);
    return {
      name: r.profiles?.display_name ?? r.profiles?.username ?? r.seller_id,
      where: `${r.method ?? '?'} ${r.account_ref ?? ''}`.trim(),
      amount: money(r.amount_cents, r.currency),
      // The number that matters if a week was missed: a seller has been promised this for
      // that long and has not had it.
      waiting: days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`,
      late: days >= 7,
    };
  });

  const html = `
    <p>These payouts are prepared and waiting on a transfer. The money has cleared its buyer's
    reversal window and is above the threshold for the seller's region. Nothing has been sent.</p>
    <table cellpadding="6" style="border-collapse:collapse" border="1">
      <tr><th align="left">Seller</th><th align="left">Send via</th><th align="right">Amount</th><th align="left">Waiting</th></tr>
      ${rows
        .map(
          (r) =>
            `<tr${r.late ? ' style="background:#fff4f4"' : ''}><td>${r.name}</td><td>${r.where}</td><td align="right">${r.amount}</td><td>${r.waiting}${r.late ? ' &#9888;' : ''}</td></tr>`
        )
        .join('')}
    </table>
    <p>Make the transfers, then confirm each one at <a href="${adminUrl}/runs">${adminUrl}/runs</a>.
    A run stays on this list until it is confirmed, so nothing falls off the end.</p>
    <p>Batch file for your bank: <a href="${adminUrl}.csv">${adminUrl}.csv</a></p>`;

  const text = [
    'These payouts are prepared and waiting on a transfer. Nothing has been sent.',
    '',
    ...rows.map((r) => `  ${r.name}  ${r.amount}  via ${r.where}  waiting ${r.waiting}${r.late ? '  <-- overdue' : ''}`),
    '',
    `Confirm each transfer at ${adminUrl}/runs. Batch file: ${adminUrl}.csv`,
    '',
    runsToCsv(runs),
  ].join('\n');

  return { html, text };
}

/**
 * Starts the balance watcher. Returns the interval so a caller can clear it; the timer is
 * unref'd, so it never holds the process open.
 *
 * The first check runs one full interval after boot, not at boot. A service that is
 * restarting in a loop would otherwise mail on every restart.
 */
export function startPayoutWatch(log: FastifyBaseLogger): NodeJS.Timeout | null {
  if (env('PAYOUT_WATCH') === 'off') return null;
  if (IS_DEMO) {
    log.info('Payout watch off: no Supabase, so there are no balances to watch');
    return null;
  }

  const to = env('PAYOUT_WATCH_EMAIL') || cfg.brevo.senderEmail;
  if (!EMAIL_ENABLED || !to) {
    log.info('Payout watch off: set BREVO_API_KEY and PAYOUT_WATCH_EMAIL to be told when payouts are due');
    return null;
  }

  const hours = Number(env('PAYOUT_WATCH_HOURS', String(DEFAULT_HOURS))) || DEFAULT_HOURS;
  const adminUrl = `${(env('RENDER_EXTERNAL_URL') || cfg.apiUrl).replace(/\/$/, '')}/admin/payouts`;

  const check = async () => {
    try {
      // Prepare first, then report everything outstanding: runs from earlier passes that
      // were never confirmed stay on the list, which is the point. A missed week does not
      // drop a seller, it makes their wait visible and growing.
      const prepared = await preparePayoutRuns();
      const waiting = await pendingPayoutRuns();
      if (!waiting.length) {
        log.info('Payout watch: nothing due');
        return;
      }
      const { html, text } = bodyFor(waiting, adminUrl);
      const sent = await sendEmail({ to, subject: subjectFor(waiting), html, text, tag: 'payout-due' }, log);
      log.info(`Payout watch: ${prepared.length} newly prepared, ${waiting.length} awaiting transfer, email ${sent ? 'sent' : 'failed'}`);
    } catch (e) {
      // A reminder failing must never take the server down with it.
      log.warn(`Payout watch failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const timer = setInterval(check, hours * 3_600_000);
  timer.unref();
  log.info(`Payout watch checking every ${hours}h, mailing ${to}`);
  return timer;
}
