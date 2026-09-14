import { api } from './api';
import type { AccountRole } from '../types';

/**
 * Where to send someone who has just signed in, signed up, or confirmed their email.
 *
 * A seller with nowhere to be paid yet goes to payouts first: nothing paid can be listed
 * until that is filled in, and asking now saves them finding out at publish time. A seller
 * who has done it goes to their dashboard. Anyone else, and anyone who was heading
 * somewhere specific, goes where they were going.
 */
export async function landingFor(role: AccountRole | null, next: string): Promise<string> {
  const generic = next === '/' || next.startsWith('/sell');
  if (role !== 'seller' || !generic) return next;
  // Demo grants purchases in the browser, so there is nobody to pay and nothing to ask for.
  if (api.isDemo) return '/sell';
  try {
    const { details } = await api.getPayoutDetails();
    return details ? '/sell' : '/sell/payouts';
  } catch {
    return '/sell';
  }
}
