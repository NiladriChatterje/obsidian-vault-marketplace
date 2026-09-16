/**
 * Business details shown on the legal pages. Payment providers' activation reviews check
 * that these pages exist, name a real operator and give a working contact route.
 *
 * A reviewer compares these against the Product Information Form, so they must match what
 * is entered there and on the payment account.
 */
export const BUSINESS = {
  /** Registered or proprietor name that appears on the payment provider account. */
  legalName: 'Niladri Chatterjee',
  /** Public trading name. */
  tradingName: 'Vault Market',
  /** Support inbox. Must be monitored: the provider and card networks use it for disputes. */
  supportEmail: 'obsidian.vault.marketplace@gmail.com',
  /** Operating address as registered with the payment provider. */
  address: 'Kolkata, West Bengal 700135, India',
  /** Courts named in the terms. */
  jurisdiction: 'the courts of Kolkata, India',
  /** Shown at the top of each policy; bump when the text changes. */
  lastUpdated: '16 September 2026',
  /** Working days to answer a support request. */
  responseDays: 3,
  /** Working days for an approved refund to reach the buyer. */
  refundDays: 7,
};
