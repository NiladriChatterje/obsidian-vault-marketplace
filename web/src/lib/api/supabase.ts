import type { AdminOverview, PayoutDetails, PayoutTerms, Profile, Purchase, Review, SellerStats, SortMode, Vault, VaultInput, VaultInsights, VaultSales, VaultStatus } from '../../types';
import { decodeCursor, encodeCursor, type Cursor } from '../cursor';
import { API_URL, MIN_PASSWORD_LENGTH, REDIRECT_ORIGIN } from '../config';
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

/** The columns each list sort orders by (all descending), most significant first; id breaks ties. */
const LIST_SORT_COLUMNS: Record<SortMode, string[]> = {
  popular: ['downloads'],
  new: ['created_at'],
  top: ['rating_avg', 'rating_count'],
};

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** A cursor value as a PostgREST filter literal; anything that is not a number or a timestamp is refused. */
function literal(v: number | string): string {
  if (typeof v === 'number') return String(v);
  if (ISO_TIMESTAMP.test(v)) return `"${v}"`;
  throw new Error('Bad cursor');
}

/**
 * PostgREST `or` filter for "rows after the cursor" under a descending sort on `columns` then id
 * ascending: the first column is smaller, or ties and the next column decides, ending on id.
 */
function afterCursor(columns: string[], cursor: Cursor): string {
  if (!UUID.test(cursor.id)) throw new Error('Bad cursor');
  const eq = (upTo: number) => columns.slice(0, upTo).map((c, j) => `${c}.eq.${literal(cursor.values[j])}`);
  const clauses = columns.map((c, i) => {
    const lt = `${c}.lt.${literal(cursor.values[i])}`;
    return i === 0 ? lt : `and(${[...eq(i), lt].join(',')})`;
  });
  clauses.push(`and(${[...eq(columns.length), `id.gt.${cursor.id}`].join(',')})`);
  return clauses.join(',');
}

async function currentUserId(): Promise<string> {
  const { data } = await requireSupabase().auth.getUser();
  if (!data.user) throw new Error('Please sign in first.');
  return data.user.id;
}

/**
 * Vault files and covers live in Sanity, reached through the payment server (see
 * catalog.ts). Supabase keeps accounts, purchases, reviews and the payout ledger, and no
 * files. These are the file methods the Backend interface still requires; without the
 * server there is nowhere to send a file, and they say so.
 */
const FILES_NEED_SERVER = 'Vault files are stored in Sanity through the catalog server. Set NEXT_PUBLIC_API_URL to upload or download.';

/** Calls the payment server with the current Supabase session token. */
async function apiFetch<T = Record<string, any>>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  if (!API_URL) throw new Error('Payment server is not configured. Set SERVER_API_URL.');
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

/** Calls the payment server without a session, which sign-in is the only case for. */
async function publicFetch<T = Record<string, any>>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('Sign-in needs the payment server. Set NEXT_PUBLIC_SERVER_API_URL.');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/**
 * Supabase states auth failures in its own vocabulary ("Invalid login credentials",
 * "User already registered"). Buyers see these verbatim, so translate the ones people
 * actually hit into something that says what to do next; anything unrecognised falls
 * through unchanged rather than being flattened into a generic message.
 */
function authMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password do not match an account.';
  // Supabase says the same thing for a wrong code, a used one and an expired one, and so do
  // we: which of the three it was is only useful to someone guessing.
  if (m.includes('token has expired or is invalid') || m.includes('otp_expired') || m.includes('invalid otp')) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  if (m.includes('email not confirmed')) return 'Confirm your email first — open the link we sent, then sign in.';
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'An account with that email already exists. Sign in instead, or reset your password.';
  }
  if (m.includes('rate limit') || m.includes('too many requests') || /after \d+ second/.test(m)) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (m.includes('password should be at least')) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (m.includes('leaked') || m.includes('weak password')) return 'That password has appeared in a data breach. Pick a different one.';
  if (m.includes('profiles_username_key') || (m.includes('duplicate key') && m.includes('username'))) {
    return 'That username is taken. Pick another.';
  }
  if (m.includes('auth session missing') || m.includes('session_not_found')) {
    return 'That link has expired. Request a new one.';
  }
  return message;
}

function authError(error: { message: string }): Error {
  return new Error(authMessage(error.message));
}

/**
 * Where Supabase sends people after they click a link in an email. Must be listed under
 * Authentication -> URL Configuration in the Supabase dashboard or the link bounces to the
 * Site URL. Returns undefined when no https origin is known, which falls back to that Site URL.
 */
function emailRedirect(path: string): string | undefined {
  const origin = /^https?:/.test(REDIRECT_ORIGIN) ? REDIRECT_ORIGIN : '';
  return origin ? `${origin}${path}` : undefined;
}

/** Free usernames are the ones no profile row holds; profiles are world-readable by policy. */
async function usernameAvailable(username: string): Promise<boolean> {
  const { count, error } = await requireSupabase()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('username', username.toLowerCase());
  if (error) throw new Error(error.message);
  return (count ?? 0) === 0;
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
  async startSignIn(email, password) {
    // Note what is NOT here: signInWithPassword. The password goes to our server, which checks
    // it and keeps the session to itself, so no amount of poking at this page from the console
    // produces a session without the emailed code. See server/src/signin-otp.ts.
    return publicFetch<{ challengeId: string; expiresInSeconds: number }>('/auth/sign-in/start', { email, password });
  },
  async verifySignIn(challengeId, code) {
    // The server hands back a one-time token hash rather than a session; Supabase turns it
    // into one here, so the session is created and stored by supabase-js exactly as it would
    // be after any other sign-in, and refreshes itself the same way.
    const { tokenHash } = await publicFetch<{ tokenHash: string }>('/auth/sign-in/verify', { challengeId, code });
    const { error } = await requireSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (error) throw authError(error);
  },
  async signUp(email, password, username, role = 'buyer') {
    // Checked here as well as in the form: the profiles trigger silently renames a clashing
    // username (nova -> nova1), so a taken name would otherwise create an account under a
    // name the seller never chose. Racy by nature; the unique constraint is the real guard.
    if (!(await usernameAvailable(username))) throw new Error('That username is taken. Pick another.');
    // The role rides in the metadata like the username does, so the profile trigger creates
    // a seller as a seller. With email confirmation on there is no session to set it from
    // until the link is clicked, which is exactly when the seller is sent on to payouts.
    const { data, error } = await requireSupabase().auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username, role }, emailRedirectTo: emailRedirect('/auth/callback') },
    });
    if (error) throw authError(error);
    return { needsEmailConfirm: !data.session };
  },
  async signOut() {
    await requireSupabase().auth.signOut();
  },
  isUsernameAvailable: usernameAvailable,
  async sendPasswordReset(email) {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: emailRedirect('/auth/reset') });
    if (error) throw authError(error);
  },
  async updatePassword(password) {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw authError(error);
  },
  async resendConfirmation(email) {
    const { error } = await requireSupabase().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: emailRedirect('/auth/callback') },
    });
    if (error) throw authError(error);
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
    // Selling used to be switched on as a side effect of payout onboarding, which no
    // longer exists: the platform is the seller of record and creators just list.
    if (patch.isSeller !== undefined) row.is_seller = patch.isSeller;
    const { data, error } = await requireSupabase().from('profiles').update(row).eq('id', id).select('*').single();
    if (error) throw authError(error);
    return toProfile(data);
  },

  async getPayoutDetails() {
    const data = await apiFetch<{ details: PayoutDetails | null; currencies: string[]; terms?: PayoutTerms }>('/me/payout-details');
    return { details: data.details ?? null, currencies: data.currencies ?? [], terms: data.terms ?? null };
  },
  async savePayoutDetails(details: PayoutDetails) {
    const data = await apiFetch<{ details: PayoutDetails }>('/me/payout-details', { method: 'PUT', body: { details } });
    return data.details;
  },
  async isAdmin() {
    // The list of administrators lives on the server. Anything that stops the question being
    // asked (no server, signed out, network) is a plain no, never an error in the nav.
    if (!API_URL) return false;
    try {
      const { admin } = await apiFetch<{ admin?: boolean }>('/admin/access');
      return !!admin;
    } catch {
      return false;
    }
  },

  /**
   * One page, keyset-paged. Each sort orders by its columns then id; a cursor holds the last row's
   * values, and the filter asks for rows strictly after them in that order. Fetches one row past
   * the limit to learn whether a next page exists. Cursor values are validated before they are
   * written into the PostgREST filter string.
   */
  async listVaults(params = {}) {
    const sort = params.sort ?? 'popular';
    const limit = params.limit ?? 50;
    const columns = LIST_SORT_COLUMNS[sort];
    const cursor = decodeCursor(params.cursor, columns.length);
    if (params.cursor && !cursor) throw new Error('Bad cursor');

    let q = requireSupabase().from('vaults').select(VAULT_SELECT).eq('status', 'published');
    if (params.category) q = q.eq('category', params.category);
    if (params.featured) q = q.eq('featured', true);
    if (params.freeOnly) q = q.eq('price_cents', 0);
    if (params.search) {
      const s = params.search.replace(/[%,()]/g, ' ').trim();
      if (s) q = q.or(`title.ilike.%${s}%,tagline.ilike.%${s}%,tags.cs.{${s.toLowerCase()}}`);
    }
    if (cursor) q = q.or(afterCursor(columns, cursor));
    for (const col of columns) q = q.order(col, { ascending: false });
    q = q.order('id', { ascending: true });

    const { data, error } = await q.limit(limit + 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ values: columns.map((c) => last[c]), id: last.id }) : null;
    return { items: page.map(toVault), nextCursor };
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
  async getVaultNotes() {
    return [];
  },
  async getNote() {
    throw new Error('Notes are only available with the Sanity catalog.');
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
  async lastOrderStatus(vaultId) {
    // Row level security keeps this to the signed-in buyer's own orders.
    const { data, error } = await requireSupabase()
      .from('orders')
      .select('status')
      .eq('vault_id', vaultId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.status ?? null;
  },
  async getDownloadUrl() {
    throw new Error(FILES_NEED_SERVER);
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
  async uploadCover() {
    throw new Error(FILES_NEED_SERVER);
  },
  async uploadVaultFile() {
    throw new Error(FILES_NEED_SERVER);
  },

  // Purchases and reviews are joined to the catalog on the server, which holds the service
  // role and the Sanity token; the browser could see neither side in full on its own.
  getMyInsights: () => apiFetch<VaultSales[]>('/me/insights'),
  getMyVaultInsights: (vaultId) => apiFetch<VaultInsights>(`/me/vaults/${encodeURIComponent(vaultId)}/insights`),
  getAdminOverview: () => apiFetch<AdminOverview>('/admin/overview'),
  getAdminVault: (vaultId) => apiFetch<VaultInsights>(`/admin/vaults/${encodeURIComponent(vaultId)}`),
};
