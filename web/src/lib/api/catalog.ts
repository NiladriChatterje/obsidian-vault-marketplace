/**
 * Sanity-backed catalog. Listings and notes live in Sanity; the payment server
 * (server/) reads them with a token and enforces who may see note bodies. This
 * wrapper points the catalog half of a Backend at that server while auth,
 * purchases and reviews keep using the wrapped backend (Supabase or demo).
 */
import type { Purchase, SellerStats, Vault, VaultInput, VaultNote, VaultNoteContent, VaultStatus } from '../../types';
import { API_URL } from '../config';
import { getSupabase } from '../supabase';
import { fileFromUri } from '../web';
import { demoStore } from './demo';
import type { Backend, UploadedFile } from './types';

type Json = Record<string, any>;

async function authHeaders(demo: boolean): Promise<Record<string, string>> {
  if (demo) {
    const [user, profile] = await Promise.all([demoStore.user(), demoStore.profile()]);
    if (!user) return {};
    return {
      'x-demo-user': user.id,
      'x-demo-username': profile?.username ?? '',
      'x-demo-displayname': encodeURIComponent(profile?.displayName ?? ''),
    };
  }
  const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function call<T = Json>(demo: boolean, path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  if (!API_URL) throw new Error('Payment server is not configured. Set SERVER_API_URL.');
  const headers: Record<string, string> = await authHeaders(demo);
  if (!init.form) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

async function blobFor(uri: string): Promise<Blob> {
  return fileFromUri(uri) ?? (await fetch(uri.split('#')[0])).blob();
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function withServerCatalog(base: Backend): Backend {
  const demo = base.isDemo;
  const get = <T = Json>(path: string) => call<T>(demo, path);
  const post = <T = Json>(path: string, body?: unknown) => call<T>(demo, path, { method: 'POST', body });

  const getVault = async (id: string): Promise<Vault | null> => {
    try {
      return await get<Vault>(`/vaults/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message)) return null;
      throw e;
    }
  };

  return {
    ...base,

    // ---- catalog
    listVaults: (params = {}) =>
      get<Vault[]>(`/vaults${qs({ category: params.category, q: params.search, sort: params.sort, featured: params.featured ? 1 : undefined, free: params.freeOnly ? 1 : undefined, limit: params.limit, offset: params.offset || undefined })}`),
    getVault,
    getSellerVaults: (sellerId) => get<Vault[]>(`/sellers/${encodeURIComponent(sellerId)}/vaults`),
    getVaultNotes: (vaultId) => get<VaultNote[]>(`/vaults/${encodeURIComponent(vaultId)}/notes`),
    getNote: (vaultId, path) => get<VaultNoteContent>(`/vaults/${encodeURIComponent(vaultId)}/notes/${path.split('/').map(encodeURIComponent).join('/')}`),

    // ---- buying
    async getLibrary() {
      if (!demo) return get<Purchase[]>('/me/library');
      const purchases = await demoStore.purchases();
      if (!purchases.length) return [];
      const vaults = await get<Vault[]>(`/vaults?ids=${purchases.map((p) => encodeURIComponent(p.vaultId)).join(',')}`);
      const byId = new Map(vaults.map((v) => [v.id, v]));
      return purchases.map((p) => ({ ...p, vault: byId.get(p.vaultId) })).filter((p) => p.vault);
    },
    async hasAccess(vaultId) {
      const user = await base.getCurrentUser();
      if (!user) return false;
      if (demo && (await demoStore.owns(vaultId))) return true;
      const { owned } = await get<{ owned: boolean }>(`/vaults/${encodeURIComponent(vaultId)}/access`);
      return owned;
    },
    async claimFreeVault(vaultId) {
      await post(`/vaults/${encodeURIComponent(vaultId)}/claim`);
      if (demo) await demoStore.grant(vaultId, 0);
    },
    async createCheckout(vaultId) {
      if (!demo) return base.createCheckout(vaultId);
      // Demo: grant locally, then hand back the real test checkout page if the server made one.
      const v = await getVault(vaultId);
      if (!v) throw new Error('Vault not found');
      await demoStore.grant(vaultId, v.priceCents);
      try {
        const { url } = await post<{ url: string }>('/checkout', { vaultId, demo: { amountCents: v.priceCents, currency: v.currency, title: v.title } });
        return { url };
      } catch {
        return { url: 'demo://purchase-complete' };
      }
    },
    async getDownloadUrl(vaultId) {
      const { url } = await get<{ url: string }>(`/vaults/${encodeURIComponent(vaultId)}/download-link`);
      return url;
    },
    async addReview(vaultId, rating, body) {
      const review = await base.addReview(vaultId, rating, body);
      if (!demo) await post(`/vaults/${encodeURIComponent(vaultId)}/refresh-rating`).catch(() => { });
      return review;
    },

    // ---- selling
    getMyVaults: () => get<Vault[]>('/me/vaults'),
    getSellerStats: () => get<SellerStats>('/me/stats'),
    saveVault: (input: VaultInput, id?: string) => post<Vault>('/vaults', { input, id }),
    async setVaultStatus(id, status: VaultStatus) {
      await post(`/vaults/${encodeURIComponent(id)}/status`, { status });
    },
    async deleteVault(id) {
      await call(demo, `/vaults/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async uploadCover(localUri) {
      const form = new FormData();
      form.append('file', await blobFor(localUri), 'cover');
      const { url } = await call<{ url: string }>(demo, '/uploads/cover', { method: 'POST', form });
      return url;
    },
    async uploadVaultFile(localUri, fileName): Promise<UploadedFile> {
      const form = new FormData();
      form.append('file', await blobFor(localUri), fileName);
      const res = await call<{ path: string; sizeBytes: number; noteCount: number }>(demo, '/uploads/vault-zip', { method: 'POST', form });
      return { path: res.path, sizeBytes: res.sizeBytes };
    },
  };
}
