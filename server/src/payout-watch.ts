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
import { balancesToCsv, sellerBalances, type SellerBalance } from './payout-ledger.ts';

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
function subjectFor(due: SellerBalance[]): string {
  const totals = new Map<string, number>();
  for (const r of due) {
    const cur = r.payout?.currency ?? r.currency;
    totals.set(cur, (totals.get(cur) ?? 0) + r.availableCents);
  }
  const who = due.length === 1 ? '1 seller' : `${due.length} sellers`;
  const sums = [...totals].map(([cur, n]) => money(n, cur)).join(' + ');
  return `Payouts due: ${who}, ${sums}`;
}

function bodyFor(due: SellerBalance[], adminUrl: string): { html: string; text: string } {
  const rows = due.map((r) => {
    const name = r.payout?.accountName ?? r.displayName ?? r.username ?? r.sellerId;
    const cur = r.payout?.currency ?? r.currency;
    return {
      name,
      where: `${r.payout?.method ?? '?'} / ${r.payout?.country ?? '?'}`,
      amount: money(r.availableCents, cur),
      cost: r.transferFeeCents === null ? '-' : money(r.transferFeeCents, cur),
      holding: r.holdingCents > 0 ? money(r.holdingCents, cur) : '-',
    };
  });

  const html = `
    <p>These sellers have cleared enough to be worth paying. Nothing has been sent; this is a reminder.</p>
    <table cellpadding="6" style="border-collapse:collapse" border="1">
      <tr><th align="left">Seller</th><th align="left">Send via</th><th align="right">Pay now</th><th align="right">Transfer cost</th><th align="right">Still clearing</th></tr>
      ${rows.map((r) => `<tr><td>${r.name}</td><td>${r.where}</td><td align="right">${r.amount}</td><td align="right">${r.cost}</td><td align="right">${r.holding}</td></tr>`).join('')}
    </table>
    <p>Make the transfers, then record them at <a href="${adminUrl}">${adminUrl}</a> so the balances clear.</p>
    <p>A batch file for your bank is at <a href="${adminUrl}.csv">${adminUrl}.csv</a>.</p>`;

  const text = [
    'These sellers have cleared enough to be worth paying. Nothing has been sent; this is a reminder.',
    '',
    ...rows.map((r) => `  ${r.name}  ${r.amount}  via ${r.where}  (transfer costs ${r.cost}, ${r.holding} still clearing)`),
    '',
    `Record the transfers at ${adminUrl}. Batch file: ${adminUrl}.csv`,
    '',
    balancesToCsv(due),
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
      const due = (await sellerBalances()).filter((r) => r.payable);
      if (!due.length) {
        log.info('Payout watch: nothing due');
        return;
      }
      const { html, text } = bodyFor(due, adminUrl);
      const sent = await sendEmail({ to, subject: subjectFor(due), html, text, tag: 'payout-due' }, log);
      log.info(`Payout watch: ${due.length} due, email ${sent ? 'sent' : 'failed'}`);
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
