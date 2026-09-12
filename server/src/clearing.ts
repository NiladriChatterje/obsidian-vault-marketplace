/**
 * How long a sale is held before it can be paid out.
 *
 * The platform's only real exposure to a refund is a sale it has already paid out: the money
 * has gone to the seller, the buyer has theirs back, and the balance goes negative with
 * nothing to recover it from unless that seller sells again. Holding each sale until it can
 * no longer be reversed removes that exposure, and costs nothing but a delay.
 *
 * The window belongs to the buyer, not the seller. A buyer in the EU, the EEA or the UK has
 * a statutory 14 day right of withdrawal on digital goods, which applies whatever the site's
 * own policy says. Elsewhere there is no such right, so a short hold against ordinary
 * payment reversals is enough and a seller is paid sooner.
 *
 * This does not cover a card chargeback, which can arrive months later. Nothing reasonable
 * would: holding every sale for the full chargeback window would mean paying sellers twice a
 * year. The hold covers the reversals that actually happen at any volume.
 */
import { cfg } from './config.ts';

/**
 * Where a statutory right of withdrawal applies to digital goods: the EU 27, the EEA three,
 * and the UK.
 */
const WITHDRAWAL_RIGHT = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB',
]);

export function hasWithdrawalRight(country?: string | null): boolean {
  return !!country && WITHDRAWAL_RIGHT.has(country.trim().toUpperCase());
}

/** Days a sale to this buyer is held. An unknown country gets the longer window. */
export function holdbackDays(buyerCountry?: string | null): number {
  if (!buyerCountry) return cfg.holdbackDaysWithdrawal;
  return hasWithdrawalRight(buyerCountry) ? cfg.holdbackDaysWithdrawal : cfg.holdbackDaysDefault;
}

/** When a sale settled now becomes payable. */
export function clearsAt(buyerCountry?: string | null, from: Date = new Date()): Date {
  return new Date(from.getTime() + holdbackDays(buyerCountry) * 24 * 60 * 60 * 1000);
}
