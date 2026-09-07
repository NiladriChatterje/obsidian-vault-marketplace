import type { PayoutDetails } from '../types';

/** Field metadata shared by the native and web payout forms. */
export const PAYOUT_FIELDS: { key: keyof PayoutDetails; label: string; placeholder: string; hint?: string; keyboard?: 'numeric' | 'phone' }[] = [
  { key: 'legalName', label: 'Full name (as on PAN)', placeholder: 'Nova Sharma' },
  { key: 'phone', label: 'Mobile number', placeholder: '9000090000', keyboard: 'phone' },
  { key: 'pan', label: 'PAN', placeholder: 'ABCDE1234F', hint: 'Needed by Razorpay to verify you.' },
  { key: 'street', label: 'Street address', placeholder: '12, 4th Cross, Indiranagar' },
  { key: 'city', label: 'City', placeholder: 'Bengaluru' },
  { key: 'state', label: 'State', placeholder: 'Karnataka' },
  { key: 'postalCode', label: 'PIN code', placeholder: '560038', keyboard: 'numeric' },
  { key: 'beneficiaryName', label: 'Account holder name', placeholder: 'Nova Sharma' },
  { key: 'accountNumber', label: 'Bank account number', placeholder: '000123456789', keyboard: 'numeric' },
  { key: 'ifsc', label: 'IFSC', placeholder: 'HDFC0000001' },
];

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
  if (!/^\d{10}$/.test(d.phone.replace(/\D/g, '').slice(-10))) return 'Enter a 10-digit mobile number.';
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
    phone: d.phone.replace(/\D/g, '').slice(-10),
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
