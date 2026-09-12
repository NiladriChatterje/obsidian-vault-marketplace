/**
 * Watches seller balances so nobody has to remember to.
 *
 * Paying sellers is the one part of the marketplace that no provider does for us: Dodo is
 * the merchant of record, so it settles one amount to the platform and never pays a creator.
 * Someone therefore has to notice when a seller is owed enough to be worth a transfer. Left
 * to a human that means opening /admin/payouts on a hunch, which is exactly the sort of
 * chore that gets skipped until a seller writes in asking where their money is.
 *
 * So this checks on a timer, prepares a run for every balance that qualifies, and mails the
 * operator when there is something to do. A balance qualifies when sellerBalances() calls
 * it `payable`, which already means both of the things that matter:
 *
 *   - cleared: past the buyer's reversal window, so sending it cannot strand us, and
 *     settled to us by Dodo, so it is our money being sent and not a loan against theirs
 *   - above threshold: worth more than roughly 23x what the transfer itself costs, which is
 *     derived per region, since a domestic transfer is cheap and a SWIFT one is not
 *
 * Nothing here moves money or changes a balance. It writes runs, and it writes an email.
 *
 * It checks shortly after boot and then every PAYOUT_WATCH_HOURS. The boot check is what
 * makes it dependable on a host that restarts the process more often than the cadence: a
 * timer whose first tick is a day after boot would never tick at all. Preparing runs is
 * idempotent, so checking early costs nothing, and each run remembers when the operator was
 * last told about it, so however often the process restarts the mail goes once per cadence.
 *
 * Runs are prepared whether or not mail is configured; the mail is how the operator hears.
 * Without BREVO_API_KEY and PAYOUT_WATCH_EMAIL (or a Brevo sender) it logs instead. Set
 * PAYOUT_WATCH=off to disable it outright.
 */
import type { FastifyBaseLogger } from 'fastify';
import { IS_DEMO, cfg } from './config.ts';
import { EMAIL_ENABLED, sendEmail } from './email.ts';
import { markRunsNotified, pendingPayoutRuns, preparePayoutRuns, runsToCsv } from './payout-ledger.ts';
import { reconcileDodoPayouts } from './settlement.ts';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

/** Once a day. Payout thresholds move slowly; checking more often would only mail more. */
const DEFAULT_HOURS = 24;
/** The first check waits this long after boot, so a service still coming up is not asked to do it. */
const BOOT_DELAY_MS = 90_000;
/** A tick that lands a little short of a full cadence still counts as one, so a daily mail stays daily. */
const CADENCE_SLACK_MS = 10 * 60_000;

type Run = Record<string, any>;

/** Minor units to a readable amount, e.g. 41908 + INR -> "INR 419.08". */
function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

/**
 * The amount, and the currency it is converted into on the way when that differs. The
 * ledger is in the platform's currency; a seller abroad is sent that amount in theirs.
 */
function amountFor(run: Run, arrow: string): string {
  const base = money(run.amount_cents, run.currency);
  return run.payout_currency && run.payout_currency !== run.currency ? `${base} ${arrow} ${run.payout_currency}` : base;
}

/**
 * Totals are per currency. Every run is in the platform's currency today, but a total that
 * quietly assumed so would be the first thing to go wrong if that ever changed.
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

/** True when the operator has not been told about this run within the last cadence. */
function dueForReminder(run: Run, cadenceMs: number): boolean {
  if (!run.notified_at) return true;
  return Date.now() - new Date(run.notified_at).getTime() >= cadenceMs - CADENCE_SLACK_MS;
}

function bodyFor(runs: Run[], adminUrl: string): { html: string; text: string } {
  const rows = runs.map((r) => {
    const days = waitingDays(r);
    return {
      name: r.profiles?.display_name ?? r.profiles?.username ?? r.seller_id,
      where: `${r.method ?? '?'} ${r.account_ref ?? ''}`.trim(),
      amount: amountFor(r, '&rarr;'),
      amountText: amountFor(r, '->'),
      // The number that matters if a week was missed: a seller has been promised this for
      // that long and has not had it.
      waiting: days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`,
      late: days >= 7,
    };
  });

  const html = `
    <p>These payouts are prepared and waiting on a transfer. The money has cleared its buyer's
    reversal window, Dodo has settled it to us, and it is above the threshold for the seller's
    region. Nothing has been sent.</p>
    <table cellpadding="6" style="border-collapse:collapse" border="1">
      <tr><th align="left">Seller</th><th align="left">Send via</th><th align="right">Amount</th><th align="left">Waiting</th></tr>
      ${rows
        .map(
          (r) =>
            `<tr${r.late ? ' style="background:#fff4f4"' : ''}><td>${r.name}</td><td>${r.where}</td><td align="right">${r.amount}</td><td>${r.waiting}${r.late ? ' &#9888;' : ''}</td></tr>`
        )
        .join('')}
    </table>
    <p>An amount is what leaves the account; an arrow shows the currency it is converted into
    for the seller on the way.</p>
    <p>Make the transfers, then confirm each one at <a href="${adminUrl}/runs">${adminUrl}/runs</a>.
    A run stays on this list until it is confirmed, so nothing falls off the end.</p>
    <p>Batch file for your bank: <a href="${adminUrl}.csv">${adminUrl}.csv</a></p>`;

  const text = [
    'These payouts are prepared and waiting on a transfer. Nothing has been sent.',
    '',
    ...rows.map((r) => `  ${r.name}  ${r.amountText}  via ${r.where}  waiting ${r.waiting}${r.late ? '  <-- overdue' : ''}`),
    '',
    'An amount is what leaves the account; an arrow shows the currency it is converted into for the seller.',
    `Confirm each transfer at ${adminUrl}/runs. Batch file: ${adminUrl}.csv`,
    '',
    runsToCsv(runs),
  ].join('\n');

  return { html, text };
}

/**
 * Starts the balance watcher. Returns the interval so a caller can clear it; both timers
 * are unref'd, so they never hold the process open.
 */
export function startPayoutWatch(log: FastifyBaseLogger): NodeJS.Timeout | null {
  if (env('PAYOUT_WATCH') === 'off') return null;
  if (IS_DEMO) {
    log.info('Payout watch off: no Supabase, so there are no balances to watch');
    return null;
  }

  const hours = Number(env('PAYOUT_WATCH_HOURS', String(DEFAULT_HOURS))) || DEFAULT_HOURS;
  const cadenceMs = hours * 3_600_000;
  const to = env('PAYOUT_WATCH_EMAIL') || cfg.brevo.senderEmail;
  // Runs are prepared either way. Without mail the operator has to look, and is told so.
  const mailTo = EMAIL_ENABLED && to ? to : null;
  const adminUrl = `${(env('RENDER_EXTERNAL_URL') || cfg.apiUrl).replace(/\/$/, '')}/admin/payouts`;

  const check = async () => {
    // Settle first: what Dodo has paid us is what can be paid on. The webhook does this as
    // payouts land; this catches any it missed. Kept apart from the rest so Dodo being
    // unreachable for a day delays new settlements, not the reminder about existing runs.
    try {
      const settled = await reconcileDodoPayouts();
      if (settled.payouts) log.info(`Payout watch: settled ${settled.purchases} sales from ${settled.payouts} Dodo payouts`);
    } catch (e) {
      log.warn(`Payout watch: could not reconcile Dodo payouts: ${e instanceof Error ? e.message : e}`);
    }
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
      if (!mailTo) {
        log.warn(`Payout watch: ${waiting.length} awaiting transfer at ${adminUrl}/runs. Set BREVO_API_KEY and PAYOUT_WATCH_EMAIL to be mailed`);
        return;
      }
      // Once per cadence, however often the process restarts. The whole list goes so the
      // operator sees everything waiting, but only when something on it has not been
      // mailed within the cadence; otherwise it was sent already, and a restart is not a
      // reason to send it again.
      if (!waiting.some((r) => dueForReminder(r, cadenceMs))) {
        log.info(`Payout watch: ${prepared.length} newly prepared, ${waiting.length} awaiting transfer, operator already told`);
        return;
      }
      const { html, text } = bodyFor(waiting, adminUrl);
      const sent = await sendEmail({ to: mailTo, subject: subjectFor(waiting), html, text, tag: 'payout-due' }, log);
      // Only a delivered mail counts as telling them. A failed one is tried again next tick.
      if (sent) await markRunsNotified(waiting.map((r) => r.id));
      log.info(`Payout watch: ${prepared.length} newly prepared, ${waiting.length} awaiting transfer, email ${sent ? 'sent' : 'failed'}`);
    } catch (e) {
      // A reminder failing must never take the server down with it.
      log.warn(`Payout watch failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const boot = setTimeout(check, BOOT_DELAY_MS);
  boot.unref();
  const timer = setInterval(check, cadenceMs);
  timer.unref();
  const mailing = mailTo ? `mailing ${mailTo}` : 'logging only (no email configured)';
  log.info(`Payout watch checking ${BOOT_DELAY_MS / 1000}s after boot and every ${hours}h, ${mailing}`);
  return timer;
}
