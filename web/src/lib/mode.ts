import type { AccountRole } from '../types';

/**
 * What the person is doing on this visit. One account can buy and sell, and the account
 * named in the server's ADMIN_USER_IDS can also run the place; the mode says which of those
 * they are here for right now, and the site shows only that side.
 *
 * The side is chosen at sign-in and can be switched on the account page. It is remembered
 * per browser, not on the profile, because it is about this visit and not about the
 * account: the same person can be selling on a laptop and buying on a phone. A remembered
 * "admin" only counts while the server still says so; anyone else who has it stored is a buyer.
 */
export type Mode = AccountRole | 'admin';

const KEY = 'vaultmarket:mode';

export function readStoredMode(): Mode | null {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    return v === 'seller' || v === 'buyer' || v === 'admin' ? v : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: Mode | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (mode) window.localStorage.setItem(KEY, mode);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the choice simply lasts for this page load.
  }
}

/** Where each mode starts, and where its brand link goes. */
export const HOME: Record<Mode, string> = { buyer: '/', seller: '/sell', admin: '/admin' };

export interface NavLink {
  href: string;
  label: string;
}

/** The tabs each mode gets. Nothing from another side is shown; the account page switches sides. */
export const NAV: Record<Mode, NavLink[]> = {
  buyer: [
    { href: '/', label: 'Explore' },
    { href: '/library', label: 'Library' },
    { href: '/connect', label: 'MCP' },
  ],
  seller: [
    { href: '/sell', label: 'Store' },
    { href: '/sell/new', label: 'New listing' },
    { href: '/sell/payouts', label: 'Payouts' },
  ],
  admin: [{ href: '/admin', label: 'Dashboard' }],
};

/**
 * The one tab a path belongs to: the longest href that prefixes it, so /sell/payouts lights
 * Payouts and not Store as well. Exact match only for the root.
 */
export function activeHref(links: NavLink[], pathname: string): string | null {
  let best: NavLink | null = null;
  for (const l of links) {
    const hit = l.href === '/' ? pathname === '/' : pathname === l.href || pathname.startsWith(`${l.href}/`);
    if (hit && (!best || l.href.length > best.href.length)) best = l;
  }
  return best?.href ?? null;
}
