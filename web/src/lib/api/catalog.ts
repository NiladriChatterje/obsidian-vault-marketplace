/**
 * Sanity-backed catalog. Listings and notes live in Sanity; the payment server
 * (server/) reads them with a token and enforces who may see note bodies. This
 * wrapper points the catalog half of a Backend at that server while auth,
 * purchases and reviews keep using the wrapped backend (Supabase or demo).
 */
import type { Purchase, SellerStats, Vault, VaultInput, VaultNote, VaultNoteContent, VaultPage, VaultStatus } from '../../types';
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
  // Only when a body goes with it: Fastify refuses a POST labelled JSON that carries none.
  if (!init.form && init.body !== undefined) headers['Content-Type'] = 'application/json';
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

  /** What POST /uploads/vault-zip/init says: post the zip here, or PUT it at `url` and hand back `key`. */
  type UploadTarget = { mode: 'direct' } | { mode: 'queued'; key: string; url: string };
  type UploadJob = { state: 'queued' | 'scanning' } | { state: 'done'; result: { path: string; sizeBytes: number } } | { state: 'failed'; error: string };

  // Polls a queued upload until the worker has an answer. A ticket sits behind other sellers'
  // zips and may be retried while the scanner comes back, so this waits a long while, and a
  // dropped poll or two is not the upload failing.
  const waitForUpload = async (jobId: string): Promise<UploadedFile> => {
    const deadline = Date.now() + 30 * 60 * 1000;
    let misses = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      let job: UploadJob;
      try {
        job = await get<UploadJob>(`/uploads/vault-zip/jobs/${encodeURIComponent(jobId)}`);
        misses = 0;
      } catch (e) {
        if (++misses >= 5) throw e;
        continue;
      }
      if (job.state === 'done') return { path: job.result.path, sizeBytes: job.result.sizeBytes };
      if (job.state === 'failed') throw new Error(job.error);
    }
    throw new Error('The scan is taking longer than expected. Your zip is still in the queue; try attaching it again in a few minutes.');
  };

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
      get<VaultPage>(`/vaults${qs({ category: params.category, q: params.search, sort: params.sort, featured: params.featured ? 1 : undefined, free: params.freeOnly ? 1 : undefined, limit: params.limit, cursor: params.cursor })}`),
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
    async uploadVaultFile(localUri, fileName, vaultId, onStage): Promise<UploadedFile> {
      const blob = await blobFor(localUri);
      // Where to send it. A deployment with the upload queue hands back a one-time link into its
      // store: the zip goes there, the server is told, and a worker scans and unpacks it while
      // this polls. Any other answer, including an older server without the route, means the
      // zip is posted here and answered in one go, as before.
      const target = await post<UploadTarget>('/uploads/vault-zip/init').catch((): UploadTarget => ({ mode: 'direct' }));
      // `vaultId` is the listing being replaced, so the storage quota does not count the copy
      // this one supersedes. Absent for a listing that has not been saved yet.
      if (target.mode === 'queued') {
        onStage?.('uploading');
        const put = await fetch(target.url, { method: 'PUT', body: blob });
        if (!put.ok) throw new Error(`The upload store did not take the zip (${put.status}). Try again.`);
        const { jobId } = await post<{ jobId: string }>(`/uploads/vault-zip/complete${qs({ vaultId })}`, { key: target.key });
        onStage?.('scanning');
        return waitForUpload(jobId);
      }
      const form = new FormData();
      form.append('file', blob, fileName);
      const res = await call<{ path: string; sizeBytes: number; noteCount: number }>(demo, `/uploads/vault-zip${qs({ vaultId })}`, { method: 'POST', form });
      return { path: res.path, sizeBytes: res.sizeBytes };
    },
  };
}
