/**
 * Business details shown on the legal pages. Payment providers' activation reviews check
 * that these pages exist, name a real operator and give a working contact route.
 *
 * FILL THESE IN before requesting live keys. The placeholders are deliberately
 * obvious so a half-finished page is easy to spot.
 */
export const BUSINESS = {
  /** Registered or proprietor name that appears on the payment provider account. */
  legalName: 'TODO Legal Name',
  /** Public trading name. */
  tradingName: 'Vault Market',
  /** Support inbox. Must be monitored: the provider and card networks use it for disputes. */
  supportEmail: 'obsidian.vault.marketplace@gmail.com',
  /** Operating address as registered with the payment provider. */
  address: 'TODO Street, City, State, PIN, India',
  /** Courts named in the terms. */
  jurisdiction: 'the courts of TODO City, India',
  /** Shown at the top of each policy; bump when the text changes. */
  lastUpdated: '11 September 2026',
  /** Working days to answer a support request. */
  responseDays: 3,
  /** Working days for an approved refund to reach the buyer. */
  refundDays: 7,
};
