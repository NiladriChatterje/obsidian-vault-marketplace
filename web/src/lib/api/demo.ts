/** localStorage behind the tiny async API the demo store uses. Safe during SSR (no window). */
const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    } catch {
      // ignore quota / privacy mode
    }
  },
};
import type { PayoutDetails, Profile, Purchase, Review, SellerStats, Vault, VaultInput, VaultStatus } from '../../types';
import { decodeCursor, encodeCursor } from '../cursor';
import { API_URL, REDIRECT_ORIGIN, platformFee } from '../config';
import { DEMO_REVIEWS, DEMO_SELLERS, DEMO_VAULTS } from '../demo-data';
import type { AuthUser, Backend } from './types';

const KEY = 'vaultmarket:demo:v1';

interface DemoState {
  user: AuthUser | null;
  profiles: Profile[];
  vaults: Vault[];
  purchases: Purchase[];
  reviews: Review[];
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

let state: DemoState | null = null;
const listeners = new Set<(u: AuthUser | null) => void>();

async function load(): Promise<DemoState> {
  if (state) return state;
  let saved: Partial<DemoState> = {};
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Partial<DemoState>;
  } catch {
    // ignore
  }
  const userVaults = (saved.vaults ?? []).filter((v) => !DEMO_VAULTS.some((d) => d.id === v.id));
  state = {
    user: saved.user ?? null,
    profiles: [...DEMO_SELLERS, ...(saved.profiles ?? []).filter((p) => !DEMO_SELLERS.some((d) => d.id === p.id))],
    vaults: [...DEMO_VAULTS, ...userVaults],
    purchases: saved.purchases ?? [],
    reviews: [...DEMO_REVIEWS, ...(saved.reviews ?? []).filter((r) => !DEMO_REVIEWS.some((d) => d.id === r.id))],
  };
  return state;
}

async function persist(): Promise<void> {
  if (!state) return;
  const toSave: DemoState = {
    user: state.user,
    profiles: state.profiles.filter((p) => !DEMO_SELLERS.some((d) => d.id === p.id)),
    vaults: state.vaults.filter((v) => !DEMO_VAULTS.some((d) => d.id === v.id)),
    purchases: state.purchases,
    reviews: state.reviews.filter((r) => !DEMO_REVIEWS.some((d) => d.id === r.id)),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(toSave)).catch(() => {});
}

function requireUser(s: DemoState): AuthUser {
  if (!s.user) throw new Error('Please sign in first.');
  return s.user;
}

function summary(p: Profile) {
  return { id: p.id, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl };
}

/**
 * Purchase bookkeeping exposed for the Sanity-backed catalog wrapper: vaults may
 * not exist in local seed data, so ownership is tracked by id alone.
 */
export const demoStore = {
  async user() {
    return (await load()).user;
  },
  async owns(vaultId: string): Promise<boolean> {
    const s = await load();
    return !!s.user && s.purchases.some((p) => p.vaultId === vaultId && p.buyerId === s.user!.id);
  },
  async grant(vaultId: string, amountCents: number): Promise<void> {
    const s = await load();
    const u = requireUser(s);
    if (s.purchases.some((p) => p.vaultId === vaultId && p.buyerId === u.id)) return;
    const fee = platformFee(amountCents);
    s.purchases.push({ id: uid(), vaultId, buyerId: u.id, amountCents, feeCents: fee, createdAt: new Date().toISOString() });
    await persist();
  },
  async purchases(): Promise<Purchase[]> {
    const s = await load();
    return s.user ? s.purchases.filter((p) => p.buyerId === s.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  },
  async profile() {
    const s = await load();
    return s.user ? s.profiles.find((p) => p.id === s.user!.id) ?? null : null;
  },
};

export const demoBackend: Backend = {
  isDemo: true,

  async getCurrentUser() {
    return (await load()).user;
  },
  onAuthChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async signIn(email) {
    const s = await load();
    await wait(400);
    const id = `demo-${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!s.profiles.some((p) => p.id === id)) {
      s.profiles.push({
        id,
        username: email.split('@')[0]?.toLowerCase() ?? 'you',
        displayName: email.split('@')[0] ?? 'You',
        isSeller: false,
        createdAt: new Date().toISOString(),
      });
    }
    s.user = { id, email };
    await persist();
    listeners.forEach((l) => l(s.user));
  },
  async signUp(email, _password, username) {
    const s = await load();
    await wait(400);
    const id = `demo-${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const existing = s.profiles.find((p) => p.id === id);
    if (existing) {
      existing.username = username;
      existing.displayName = username;
    } else {
      s.profiles.push({
        id,
        username,
        displayName: username,
        isSeller: false,
        createdAt: new Date().toISOString(),
      });
    }
    s.user = { id, email };
    await persist();
    listeners.forEach((l) => l(s.user));
    return { needsEmailConfirm: false };
  },
  async isUsernameAvailable(username) {
    const s = await load();
    return !s.profiles.some((p) => p.username.toLowerCase() === username.toLowerCase() && p.id !== s.user?.id);
  },
  async sendPasswordReset() {
    // No mail server and no passwords in demo mode; resolve so the UI shows the same copy.
    await wait(300);
  },
  async updatePassword() {
    await wait(300);
  },
  async resendConfirmation() {
    await wait(300);
  },
  async signOut() {
    const s = await load();
    s.user = null;
    await persist();
    listeners.forEach((l) => l(null));
  },
  async getProfile(userId) {
    const s = await load();
    return s.profiles.find((p) => p.id === userId) ?? null;
  },
  async updateProfile(patch) {
    const s = await load();
    const u = requireUser(s);
    const p = s.profiles.find((x) => x.id === u.id);
    if (!p) throw new Error('Profile not found');
    Object.assign(p, patch);
    await persist();
    return p;
  },

  async getPayoutDetails() {
    // Demo grants purchases in the browser, so there is nobody to pay and nothing to gate.
    return { details: null, currencies: [] };
  },
  async savePayoutDetails(details: PayoutDetails) {
    return details;
  },

  async listVaults(params = {}) {
    const s = await load();
    await wait(150);
    let list = s.vaults.filter((v) => v.status === 'published');
    if (params.category) list = list.filter((v) => v.category === params.category);
    if (params.featured) list = list.filter((v) => v.featured);
    if (params.freeOnly) list = list.filter((v) => v.priceCents === 0);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.tagline.toLowerCase().includes(q) ||
          v.tags.some((t) => t.includes(q)) ||
          v.plugins.some((p) => p.toLowerCase().includes(q))
      );
    }
    switch (params.sort ?? 'popular') {
      case 'new':
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case 'top':
        list.sort((a, b) => b.ratingAvg * Math.log10(b.ratingCount + 1) - a.ratingAvg * Math.log10(a.ratingCount + 1));
        break;
      default:
        list.sort((a, b) => b.downloads - a.downloads);
    }
    // The demo list is small and sorted in memory, so the cursor is simply the id the last page ended on.
    const cursor = decodeCursor(params.cursor, 0);
    const start = cursor ? list.findIndex((v) => v.id === cursor.id) + 1 : 0;
    const limit = params.limit ?? 50;
    const page = list.slice(start, start + limit);
    const last = page[page.length - 1];
    return { items: page, nextCursor: start + limit < list.length && last ? encodeCursor({ values: [], id: last.id }) : null };
  },
  async getVault(id) {
    const s = await load();
    return s.vaults.find((v) => v.id === id) ?? null;
  },
  async getSellerVaults(sellerId) {
    const s = await load();
    return s.vaults.filter((v) => v.sellerId === sellerId && v.status === 'published');
  },
  async getReviews(vaultId) {
    const s = await load();
    return s.reviews.filter((r) => r.vaultId === vaultId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async getVaultNotes() {
    return [];
  },
  async getNote() {
    throw new Error('Notes are only available with the Sanity catalog.');
  },
  async addReview(vaultId, rating, body) {
    const s = await load();
    const u = requireUser(s);
    const profile = s.profiles.find((p) => p.id === u.id);
    const review: Review = {
      id: uid(),
      vaultId,
      userId: u.id,
      rating,
      body,
      createdAt: new Date().toISOString(),
      author: profile ? summary(profile) : undefined,
    };
    s.reviews = s.reviews.filter((r) => !(r.vaultId === vaultId && r.userId === u.id));
    s.reviews.push(review);
    const vault = s.vaults.find((v) => v.id === vaultId);
    if (vault) {
      const all = s.reviews.filter((r) => r.vaultId === vaultId);
      vault.ratingCount = all.length;
      vault.ratingAvg = all.reduce((sum, r) => sum + r.rating, 0) / all.length;
    }
    await persist();
    return review;
  },

  async getLibrary() {
    const s = await load();
    const u = s.user;
    if (!u) return [];
    return s.purchases
      .filter((p) => p.buyerId === u.id)
      .map((p) => ({ ...p, vault: s.vaults.find((v) => v.id === p.vaultId) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async hasAccess(vaultId) {
    const s = await load();
    if (!s.user) return false;
    const vault = s.vaults.find((v) => v.id === vaultId);
    if (vault?.sellerId === s.user.id) return true;
    return s.purchases.some((p) => p.vaultId === vaultId && p.buyerId === s.user!.id);
  },
  async claimFreeVault(vaultId) {
    const s = await load();
    const u = requireUser(s);
    const vault = s.vaults.find((v) => v.id === vaultId);
    if (!vault) throw new Error('Vault not found');
    if (vault.priceCents !== 0) throw new Error('This vault is not free');
    if (!s.purchases.some((p) => p.vaultId === vaultId && p.buyerId === u.id)) {
      s.purchases.push({ id: uid(), vaultId, buyerId: u.id, amountCents: 0, feeCents: 0, createdAt: new Date().toISOString() });
      vault.downloads += 1;
    }
    await persist();
  },
  async createCheckout(vaultId) {
    // Demo: the purchase is granted locally right away. When the payment server is
    // running, a real *test* checkout is still created so the flow
    // can be tried end to end; the outcome of that test payment is not enforced.
    const s = await load();
    const u = requireUser(s);
    const vault = s.vaults.find((v) => v.id === vaultId);
    if (!vault) throw new Error('Vault not found');
    let url = 'demo://purchase-complete';
    if (API_URL) {
      try {
        const res = await fetch(`${API_URL}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vaultId,
            redirectOrigin: REDIRECT_ORIGIN,
            demo: { amountCents: vault.priceCents, currency: vault.currency, title: vault.title },
          }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (res.ok && data.url) url = data.url;
      } catch {
        // Server not running: fall back to the instant demo purchase.
      }
    } else {
      await wait(700);
    }
    if (!s.purchases.some((p) => p.vaultId === vaultId && p.buyerId === u.id)) {
      const fee = platformFee(vault.priceCents);
      s.purchases.push({
        id: uid(),
        vaultId,
        buyerId: u.id,
        amountCents: vault.priceCents,
        feeCents: fee,
        createdAt: new Date().toISOString(),
      });
      vault.downloads += 1;
    }
    await persist();
    return { url };
  },
  async getDownloadUrl(vaultId) {
    const s = await load();
    const vault = s.vaults.find((v) => v.id === vaultId);
    if (!vault) throw new Error('Vault not found');
    // Demo vaults have no real file; point at the Obsidian sample vault docs.
    return vault.filePath ?? 'https://help.obsidian.md/Getting+started/Download+and+install+Obsidian';
  },

  async getMyVaults() {
    const s = await load();
    const u = s.user;
    if (!u) return [];
    return s.vaults.filter((v) => v.sellerId === u.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getSellerStats() {
    const s = await load();
    const u = s.user;
    if (!u) return { grossCents: 0, feeCents: 0, netCents: 0, salesCount: 0, downloads: 0, publishedCount: 0 };
    const mine = s.vaults.filter((v) => v.sellerId === u.id);
    const ids = new Set(mine.map((v) => v.id));
    const sales = s.purchases.filter((p) => ids.has(p.vaultId));
    const gross = sales.reduce((sum, p) => sum + p.amountCents, 0);
    const fee = sales.reduce((sum, p) => sum + p.feeCents, 0);
    const stats: SellerStats = {
      grossCents: gross,
      feeCents: fee,
      netCents: gross - fee,
      salesCount: sales.filter((p) => p.amountCents > 0).length,
      downloads: mine.reduce((sum, v) => sum + v.downloads, 0),
      publishedCount: mine.filter((v) => v.status === 'published').length,
    };
    return stats;
  },
  async saveVault(input: VaultInput, id?: string) {
    const s = await load();
    const u = requireUser(s);
    const profile = s.profiles.find((p) => p.id === u.id);
    const now = new Date().toISOString();
    if (id) {
      const existing = s.vaults.find((v) => v.id === id && v.sellerId === u.id);
      if (!existing) throw new Error('Listing not found');
      Object.assign(existing, input, { updatedAt: now });
      await persist();
      return existing;
    }
    const vault: Vault = {
      id: uid(),
      sellerId: u.id,
      seller: profile ? summary(profile) : undefined,
      currency: 'INR',
      screenshots: [],
      sizeBytes: 0,
      status: 'draft',
      downloads: 0,
      ratingAvg: 0,
      ratingCount: 0,
      featured: false,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    s.vaults.push(vault);
    await persist();
    return vault;
  },
  async setVaultStatus(id, status: VaultStatus) {
    const s = await load();
    const u = requireUser(s);
    const v = s.vaults.find((x) => x.id === id && x.sellerId === u.id);
    if (!v) throw new Error('Listing not found');
    v.status = status;
    v.updatedAt = new Date().toISOString();
    await persist();
  },
  async deleteVault(id) {
    const s = await load();
    const u = requireUser(s);
    s.vaults = s.vaults.filter((v) => !(v.id === id && v.sellerId === u.id));
    await persist();
  },
  async uploadCover(localUri) {
    await wait(300);
    return localUri;
  },
  async uploadVaultFile(localUri, _fileName) {
    await wait(600);
    return { path: localUri, sizeBytes: 0 };
  },
};
