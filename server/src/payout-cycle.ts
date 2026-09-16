/**
 * When sellers are paid: once a month, on one day.
 *
 * A payout is a batch of transfers an operator makes by hand, and a batch is cheapest and
 * least error-prone when it happens on a fixed day rather than whenever a balance happens to
 * cross its threshold. So balances are measured as they stood at the start of the cycle
 * day, and a run is prepared for every seller who was over threshold then. A sale that
 * clears on the 29th waits for the next 28th, however large.
 *
 * The day is reckoned in the platform's time zone, not the server's: a host in another
 * region must not move payday by a day. Months shorter than the cycle day pay on their last
 * day, which cannot happen at 28 but costs nothing to get right.
 */
import { cfg } from './config.ts';

export interface PayoutCycle {
  /** Day of the month payouts go out, 1-28. */
  day: number;
  timeZone: string;
  /**
   * Start of the most recent payout day at or before now. Balances are measured as they
   * stood at this instant, and this is the cycle the current window belongs to.
   */
  current: Date;
  /** Start of the next payout day after now. */
  next: Date;
}

/** Milliseconds a zone is ahead of UTC at the given instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** Midnight at the start of the given calendar day in the zone, as an instant. */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  // Guess UTC midnight, then correct by the zone's offset; a second pass catches a guess
  // that landed on the other side of a daylight-saving change.
  let guess = Date.UTC(year, month, day);
  for (let i = 0; i < 2; i++) guess = Date.UTC(year, month, day) - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The year, month (0-based) and day of the month it is in the zone right now. */
function wallDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: n('year'), month: n('month') - 1, day: n('day') };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The payout day of the given month, as an instant: the configured day, or the month's last if it is shorter. */
function payoutDayOf(year: number, month: number, day: number, timeZone: string): Date {
  // Normalise a month outside 0-11 the way Date.UTC would, so callers can pass month +/- 1.
  const norm = new Date(Date.UTC(year, month, 1));
  const y = norm.getUTCFullYear();
  const m = norm.getUTCMonth();
  return zonedMidnight(y, m, Math.min(day, daysInMonth(y, m)), timeZone);
}

export function payoutCycle(now: Date = new Date()): PayoutCycle {
  const day = cfg.payoutCycleDay;
  const timeZone = cfg.payoutTimeZone;
  const today = wallDate(now, timeZone);
  const thisMonth = payoutDayOf(today.year, today.month, day, timeZone);
  const onOrPast = now.getTime() >= thisMonth.getTime();
  return {
    day,
    timeZone,
    current: onOrPast ? thisMonth : payoutDayOf(today.year, today.month - 1, day, timeZone),
    next: onOrPast ? payoutDayOf(today.year, today.month + 1, day, timeZone) : thisMonth,
  };
}

