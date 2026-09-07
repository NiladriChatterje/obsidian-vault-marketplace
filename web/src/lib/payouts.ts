import type { PayoutDetails } from '../types';

/** Field metadata shared by the native and web payout forms. */
export const PAYOUT_FIELDS: { key: keyof PayoutDetails; label: string; placeholder: string; hint?: string; keyboard?: 'numeric' | 'phone' }[] = [
  { key: 'legalName', label: 'Full name (as on PAN)', placeholder: 'Nova Sharma' },
  {
    key: 'phone',
    label: 'Mobile number (with country code)',
    placeholder: '+[country code] [number], e.g. +91 9000090000',
    hint: 'Type the + sign, then your country code (India is 91), then the number. Spaces and dashes are fine.',
    keyboard: 'phone',
  },
  { key: 'pan', label: 'PAN', placeholder: 'ABCDE1234F', hint: 'Needed by Razorpay to verify you.' },
  { key: 'street', label: 'Street address', placeholder: '12, 4th Cross, Indiranagar' },
  { key: 'city', label: 'City', placeholder: 'Bengaluru' },
  { key: 'state', label: 'State', placeholder: 'Karnataka' },
  { key: 'postalCode', label: 'PIN code', placeholder: '560038', keyboard: 'numeric' },
  { key: 'beneficiaryName', label: 'Account holder name', placeholder: 'Nova Sharma' },
  { key: 'accountNumber', label: 'Bank account number', placeholder: '000123456789', keyboard: 'numeric' },
  { key: 'ifsc', label: 'IFSC', placeholder: 'HDFC0000001' },
];

/**
 * E.164: a leading +, a country code (1-3 digits, not starting with 0) and a
 * national number, 8-15 digits in total. Spaces, dashes and brackets are allowed.
 */
export const PHONE_E164 = /^\+[1-9]\d{7,14}$/;

/** Removes formatting but keeps the leading +; "0091 …" and "91…" without + are rejected by PHONE_E164. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export const EMPTY_PAYOUT_DETAILS: PayoutDetails = {
  legalName: '',
  phone: '',
  pan: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  accountNumber: '',
  ifsc: '',
  beneficiaryName: '',
};

/** Returns the first problem with the details, or null when they can be submitted. */
export function validatePayoutDetails(d: PayoutDetails): string | null {
  if (d.legalName.trim().length < 4) return 'Enter your full legal name.';
  if (!d.phone.trim().startsWith('+')) return 'Mobile number must start with your country code, e.g. +91 9000090000.';
  if (!PHONE_E164.test(normalizePhone(d.phone))) return 'Enter a valid mobile number with country code, e.g. +91 9000090000.';
  if (!/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(d.pan.trim())) return 'PAN must look like ABCDE1234F.';
  if (d.street.trim().length < 3 || d.city.trim().length < 2 || d.state.trim().length < 2) return 'Enter your full address.';
  if (!/^\d{6}$/.test(d.postalCode.trim())) return 'PIN code must be 6 digits.';
  if (d.beneficiaryName.trim().length < 3) return 'Enter the bank account holder name.';
  if (!/^\d{9,18}$/.test(d.accountNumber.trim())) return 'Bank account number must be 9–18 digits.';
  if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(d.ifsc.trim())) return 'IFSC must look like HDFC0000001.';
  return null;
}

export function normalizePayoutDetails(d: PayoutDetails): PayoutDetails {
  return {
    legalName: d.legalName.trim(),
    phone: normalizePhone(d.phone),
    pan: d.pan.trim().toUpperCase(),
    street: d.street.trim(),
    city: d.city.trim(),
    state: d.state.trim(),
    postalCode: d.postalCode.trim(),
    accountNumber: d.accountNumber.trim(),
    ifsc: d.ifsc.trim().toUpperCase(),
    beneficiaryName: d.beneficiaryName.trim(),
  };
}
