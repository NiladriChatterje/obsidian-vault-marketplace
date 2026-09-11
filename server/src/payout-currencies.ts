/**
 * Currencies a seller can be paid in.
 *
 * This is Dodo's ISO 4217 payout list. Dodo settles to the platform, not to sellers, so it
 * is not a hard limit on what a seller may be paid: it is the set the platform can hold
 * and convert from without an extra hop. Refusing anything outside it is the honest
 * position, because a currency that cannot be settled is a seller who cannot be paid, and
 * that is worth saying before they write a listing rather than after someone buys it.
 */
export const PAYOUT_CURRENCIES = [
  'AED', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD',
  'BND', 'BOB', 'BRL', 'BSD', 'BWP', 'BYN', 'BZD', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ',
  'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR',
  'KMF', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK',
  'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SEK',
  'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SZL', 'THB', 'TND', 'TOP', 'TRY', 'TTD', 'TWD',
  'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR',
  'ZMW',
] as const;

const SUPPORTED = new Set<string>(PAYOUT_CURRENCIES);

export function isPayoutCurrency(code: string): boolean {
  return SUPPORTED.has(code.trim().toUpperCase());
}

/**
 * The currency a country is normally paid in. Only a hint for prefilling the form: a
 * seller may legitimately want USD or EUR instead, so the form stays editable and only the
 * currency itself is validated.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  AE: 'AED', AR: 'ARS', AU: 'AUD', BD: 'BDT', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY', CO: 'COP', CZ: 'CZK',
  DK: 'DKK', EG: 'EGP', GB: 'GBP', GH: 'GHS', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', JP: 'JPY',
  KE: 'KES', KR: 'KRW', LK: 'LKR', MA: 'MAD', MX: 'MXN', MY: 'MYR', NG: 'NGN', NO: 'NOK', NP: 'NPR', NZ: 'NZD',
  PE: 'PEN', PH: 'PHP', PK: 'PKR', PL: 'PLN', RO: 'RON', SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY',
  TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', US: 'USD', VN: 'VND', ZA: 'ZAR',
  // The euro area, which shares one code across many countries.
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR', GR: 'EUR', IE: 'EUR',
  IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
};

export function suggestedCurrency(country: string): string | null {
  return COUNTRY_CURRENCY[country.trim().toUpperCase()] ?? null;
}
