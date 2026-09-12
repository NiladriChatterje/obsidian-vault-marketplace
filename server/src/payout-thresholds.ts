/**
 * How much a seller must accrue before it is worth transferring it to them.
 *
 * A transfer fee is a fixed cost per *payout*, while the commission is earned per *sale*.
 * That is the same shape mismatch the fixed half of the commission fixed one level down,
 * and the same two answers apply: charge it on, or amortise it. This amortises it.
 *
 * The threshold is derived rather than chosen. Per sale the platform keeps
 *
 *   kept  = price x (fee% - provider%) / 100 + (feeFixed - providerFixed)
 *   share = price x (100 - fee%) / 100 - feeFixed
 *
 * so the ratio kept/share falls as the price rises and bottoms out at
 * `(fee% - provider%) / (100 - fee%)`, which is 6/90 at a 10% commission against a 4%
 * provider. By the time a seller has accrued T, the platform has therefore earned at least
 * T x that ratio, whatever mix of prices got them there. Pay only once that covers the
 * transfer and the transfer can never cost more than the sales that produced it.
 *
 * Amounts are in the listing currency's minor units, like everything else in the ledger.
 */
import { cfg } from './config.ts';

export type PayoutMethod = 'bank' | 'wise' | 'payoneer' | 'paypal';

/**
 * What it costs the platform to send one payout. Estimates, and deliberately pessimistic:
 * guessing high delays a payout, guessing low loses money on it.
 *
 * A bank transfer is the one that swings wildly. Domestically it is IMPS or NEFT and costs
 * almost nothing; to another country it is a wire with intermediary bank charges.
 */
const TRANSFER_COST: Record<string, number> = {
  'bank:domestic': Number(cfg.transferCost.bankDomestic),
  'bank:international': Number(cfg.transferCost.bankInternational),
  wise: Number(cfg.transferCost.wise),
  payoneer: Number(cfg.transferCost.payoneer),
  paypal: Number(cfg.transferCost.paypal),
};

export function transferCostCents(method: PayoutMethod, country: string): number {
  if (method === 'bank') {
    const domestic = country.trim().toUpperCase() === cfg.platformCountry;
    return TRANSFER_COST[domestic ? 'bank:domestic' : 'bank:international'];
  }
  return TRANSFER_COST[method] ?? cfg.transferCost.bankInternational;
}

/**
 * The worst-case share of a seller's accrual that the platform has earned alongside it.
 * Derived from the commission so changing either half moves every threshold with it.
 */
export function commissionRatio(): number {
  const margin = cfg.feePercent - cfg.providerPercentFee;
  if (margin <= 0) return 0;
  return margin / (100 - cfg.feePercent);
}

/**
 * What a seller must accrue before paying them is worth it.
 *
 * Returns the floor for a seller who has not said how they want to be paid yet: nothing can
 * be sent to them anyway, so the cheapest assumption would be misleading.
 */
export function payoutThresholdCents(method: PayoutMethod | null, country: string | null): number {
  const ratio = commissionRatio();
  // A commission that cannot outpace the provider can never cover a transfer either.
  if (ratio <= 0) return Number.MAX_SAFE_INTEGER;

  const fee = method ? transferCostCents(method, country ?? '') : cfg.transferCost.bankInternational;
  const breakEven = fee / ratio;
  const withHeadroom = breakEven * cfg.payoutSafetyFactor;
  // Round up to a round Rs 100 so the number reads like a policy rather than a calculation.
  const rounded = Math.ceil(withHeadroom / 10000) * 10000;
  return Math.max(cfg.payoutMinCents, rounded);
}
