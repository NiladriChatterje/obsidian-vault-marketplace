import { File } from 'expo-file-system';
import type { PayoutStatus, Profile, Purchase, Review, SellerStats, Vault, VaultInput, VaultStatus } from '../../types';
import { API_URL, REDIRECT_ORIGIN, STORAGE_BUCKETS } from '../config';
import { requireSupabase } from '../supabase';
import type { AuthUser, Backend } from './types';

/* ---------- row mappers (snake_case DB -> camelCase app) ---------- */

type Row = Record<string, any>;

function toProfile(r: Row): Profile {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name ?? r.username,
    avatarUrl: r.avatar_url,
    bio: r.bio,
    isSeller: !!r.is_seller,
    razorpayAccountId: r.razorpay_account_id,
    payoutsEnabled: !!r.payouts_enabled,
    createdAt: r.created_at,
  };
}

function toVault(r: Row): Vault {
  const seller = r.seller ?? r.profiles;
  return {
    id: r.id,
    sellerId: r.seller_id,
    seller: seller
      ? { id: seller.id, username: seller.username, displayName: seller.display_name ?? seller.username, avatarUrl: seller.avatar_url }
      : undefined,
    title: r.title,
    tagline: r.tagline ?? '',
    description: r.description ?? '',
    category: r.category,
    tags: r.tags ?? [],
    priceCents: r.price_cents ?? 0,
    currency: r.currency ?? 'USD',
    coverUrl: r.cover_url,
    screenshots: r.screenshots ?? [],
    plugins: r.plugins ?? [],
    noteCount: r.note_count ?? 0,
    sizeBytes: r.size_bytes ?? 0,
    version: r.version ?? '1.0',
    filePath: r.file_path,
    status: r.status,
    downloads: r.downloads ?? 0,
    ratingAvg: Number(r.rating_avg ?? 0),
    ratingCount: r.rating_count ?? 0,
    featured: !!r.featured,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function fromVaultInput(input: VaultInput): Row {
  const row: Row = {
    title: input.title,
    tagline: input.tagline,
    description: input.description,
    category: input.category,
    tags: input.tags,
    price_cents: input.priceCents,
    plugins: input.plugins,
    note_count: input.noteCount,
    version: input.version,
  };
  if (input.coverUrl !== undefined) row.cover_url = input.coverUrl;
  if (input.screenshots !== undefined) row.screenshots = input.screenshots;
  if (input.filePath !== undefined) row.file_path = input.filePath;
  if (input.sizeBytes !== undefined) row.size_bytes = input.sizeBytes;
  if (input.status !== undefined) row.status = input.status;
  return row;
}

function toReview(r: Row): Review {
  const a = r.author ?? r.profiles;
  return {
    id: r.id,
    vaultId: r.vault_id,
    userId: r.user_id,
    rating: r.rating,
    body: r.body ?? '',
    createdAt: r.created_at,
    author: a ? { id: a.id, username: a.username, displayName: a.display_name ?? a.username, avatarUrl: a.avatar_url } : undefined,
  };
}

const VAULT_SELECT = '*, seller:profiles!vaults_seller_id_fkey(id, username, display_name, avatar_url)';

async function currentUserId(): Promise<string> {
  const { data } = await requireSupabase().auth.getUser();
  if (!data.user) throw new Error('Please sign in first.');
  return data.user.id;
}

async function readBytes(localUri: string): Promise<Uint8Array> {
  const file = new File(localUri);
  return file.bytes();
}

function extFromUri(uri: string, fallback: string): string {
  const match = /\.([a-zA-Z0-9]+)(\?|$)/.exec(uri);
  return match?.[1]?.toLowerCase() ?? fallback;
}

/** Calls the payment server with the current Supabase session token. */
async function apiFetch<T = Record<string, any>>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  if (!API_URL) throw new Error('Payment server is not configured. Set EXPO_PUBLIC_API_URL.');
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first.');
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/* ---------- backend ---------- */

export const supabaseBackend: Backend = {
  isDemo: false,

  async getCurrentUser() {
    const { data } = await requireSupabase().auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? '' } : null;
  },
  onAuthChange(cb) {
    const { data } = requireSupabase().auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      cb(u ? { id: u.id, email: u.email ?? '' } : null);
    });
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  },
  async signUp(email, password, username) {
    const { data, error } = await requireSupabase().auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });
    if (error) throw new Error(error.message);
    return { needsEmailConfirm: !data.session };
  },
  async signOut() {
    await requireSupabase().auth.signOut();
  },
  async getProfile(userId) {
    const { data, error } = await requireSupabase().from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toProfile(data) : null;
  },
  async updateProfile(patch) {
    const id = await currentUserId();
    const row: Row = {};
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.username !== undefined) row.username = patch.username;
    const { data, error } = await requireSupabase().from('profiles').update(row).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    return toProfile(data);
  },

  async listVaults(params = {}) {
    let q = requireSupabase().from('vaults').select(VAULT_SELECT).eq('status', 'published');
    if (params.category) q = q.eq('category', params.category);
    if (params.featured) q = q.eq('featured', true);
    if (params.freeOnly) q = q.eq('price_cents', 0);
    if (params.search) {
      const s = params.search.replace(/[%,()]/g, ' ').trim();
      if (s) q = q.or(`title.ilike.%${s}%,tagline.ilike.%${s}%,tags.cs.{${s.toLowerCase()}}`);
    }
    switch (params.sort ?? 'popular') {
      case 'new':
        q = q.order('created_at', { ascending: false });
        break;
      case 'top':
        q = q.order('rating_avg', { ascending: false }).order('rating_count', { ascending: false });
        break;
      default:
        q = q.order('downloads', { ascending: false });
    }
    const { data, error } = await q.limit(params.limit ?? 50);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toVault);
  },
  async getVault(id) {
    const { data, error } = await requireSupabase().from('vaults').select(VAULT_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toVault(data) : null;
  },
  async getSellerVaults(sellerId) {
    const { data, error } = await requireSupabase()
      .from('vaults')
      .select(VAULT_SELECT)
      .eq('seller_id', sellerId)
      .eq('status', 'published')
      .order('downloads', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toVault);
  },
  async getReviews(vaultId) {
    const { data, error } = await requireSupabase()
      .from('reviews')
      .select('*, author:profiles!reviews_user_id_fkey(id, username, display_name, avatar_url)')
      .eq('vault_id', vaultId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toReview);
  },
  async addReview(vaultId, rating, body) {
    const userId = await currentUserId();
    const { data, error } = await requireSupabase()
      .from('reviews')
      .upsert({ vault_id: vaultId, user_id: userId, rating, body }, { onConflict: 'vault_id,user_id' })
      .select('*, author:profiles!reviews_user_id_fkey(id, username, display_name, avatar_url)')
      .single();
    if (error) throw new Error(error.message);
    return toReview(data);
  },

  async getLibrary() {
    const { data, error } = await requireSupabase()
      .from('purchases')
      .select(`*, vault:vaults(${VAULT_SELECT})`)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(
      (r: Row): Purchase => ({
        id: r.id,
        vaultId: r.vault_id,
        buyerId: r.buyer_id,
        amountCents: r.amount_cents,
        feeCents: r.fee_cents,
        createdAt: r.created_at,
        vault: r.vault ? toVault(r.vault) : undefined,
      })
    );
  },
  async hasAccess(vaultId) {
    const { data, error } = await requireSupabase().rpc('has_vault_access', { p_vault_id: vaultId });
    if (error) throw new Error(error.message);
    return !!data;
  },
  async claimFreeVault(vaultId) {
    const { error } = await requireSupabase().rpc('claim_free_vault', { p_vault_id: vaultId });
    if (error) throw new Error(error.message);
  },
  async createCheckout(vaultId) {
    const data = await apiFetch<{ url?: string }>('/checkout', { method: 'POST', body: { vaultId, redirectOrigin: REDIRECT_ORIGIN } });
    if (!data.url) throw new Error('Checkout could not be started.');
    return { url: data.url };
  },
  async getDownloadUrl(vaultId) {
    const sb = requireSupabase();
    const { data: vault, error } = await sb.from('vaults').select('file_path').eq('id', vaultId).single();
    if (error) throw new Error(error.message);
    if (!vault?.file_path) throw new Error('This vault has no file attached yet.');
    const { data, error: urlError } = await sb.storage.from(STORAGE_BUCKETS.files).createSignedUrl(vault.file_path, 300, {
      download: true,
    });
    if (urlError || !data) throw new Error(urlError?.message ?? 'Could not create download link.');
    await sb.rpc('increment_downloads', { p_vault_id: vaultId });
    return data.signedUrl;
  },

  async getMyVaults() {
    const userId = await currentUserId();
    const { data, error } = await requireSupabase()
      .from('vaults')
      .select(VAULT_SELECT)
      .eq('seller_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toVault);
  },
  async getSellerStats() {
    const { data, error } = await requireSupabase().rpc('seller_stats');
    if (error) throw new Error(error.message);
    const r = (Array.isArray(data) ? data[0] : data) ?? {};
    const stats: SellerStats = {
      grossCents: Number(r.gross_cents ?? 0),
      feeCents: Number(r.fee_cents ?? 0),
      netCents: Number(r.gross_cents ?? 0) - Number(r.fee_cents ?? 0),
      salesCount: Number(r.sales_count ?? 0),
      downloads: Number(r.downloads ?? 0),
      publishedCount: Number(r.published_count ?? 0),
    };
    return stats;
  },
  async saveVault(input, id) {
    const sb = requireSupabase();
    const userId = await currentUserId();
    const row = fromVaultInput(input);
    if (id) {
      const { data, error } = await sb.from('vaults').update(row).eq('id', id).eq('seller_id', userId).select(VAULT_SELECT).single();
      if (error) throw new Error(error.message);
      return toVault(data);
    }
    const { data, error } = await sb
      .from('vaults')
      .insert({ ...row, seller_id: userId })
      .select(VAULT_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return toVault(data);
  },
  async setVaultStatus(id, status: VaultStatus) {
    const { error } = await requireSupabase().from('vaults').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteVault(id) {
    const { error } = await requireSupabase().from('vaults').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  async uploadCover(localUri) {
    const sb = requireSupabase();
    const userId = await currentUserId();
    const ext = extFromUri(localUri, 'jpg');
    const path = `${userId}/${Date.now()}.${ext}`;
    const bytes = await readBytes(localUri);
    const { error } = await sb.storage.from(STORAGE_BUCKETS.covers).upload(path, bytes, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return sb.storage.from(STORAGE_BUCKETS.covers).getPublicUrl(path).data.publicUrl;
  },
  async uploadVaultFile(localUri, fileName) {
    const sb = requireSupabase();
    const userId = await currentUserId();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${Date.now()}-${safeName}`;
    const bytes = await readBytes(localUri);
    const { error } = await sb.storage.from(STORAGE_BUCKETS.files).upload(path, bytes, {
      contentType: 'application/zip',
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { path, sizeBytes: bytes.byteLength };
  },
  async setupPayouts(details) {
    const data = await apiFetch<{ status?: PayoutStatus }>('/payouts', { method: 'POST', body: { details } });
    return { status: data.status ?? 'pending' };
  },
  async refreshPayoutStatus() {
    const data = await apiFetch<{ status?: PayoutStatus }>('/payouts/status');
    return { status: data.status ?? 'none' };
  },
};
