import type {
  ListVaultsParams,
  PayoutDetails,
  PayoutStatus,
  Profile,
  Purchase,
  Review,
  SellerStats,
  Vault,
  VaultInput,
  VaultStatus,
} from '../../types';

export interface AuthUser {
  id: string;
  email: string;
}

export interface UploadedFile {
  path: string;
  sizeBytes: number;
}

/**
 * Everything the UI needs from a backend. Two implementations exist:
 * `demoBackend` (in-memory, runs anywhere) and `supabaseBackend` (production).
 */
export interface Backend {
  readonly isDemo: boolean;

  // Auth
  getCurrentUser(): Promise<AuthUser | null>;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, username: string): Promise<{ needsEmailConfirm: boolean }>;
  signOut(): Promise<void>;
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, 'displayName' | 'bio' | 'username'>>): Promise<Profile>;

  // Catalog
  listVaults(params?: ListVaultsParams): Promise<Vault[]>;
  getVault(id: string): Promise<Vault | null>;
  getSellerVaults(sellerId: string): Promise<Vault[]>;
  getReviews(vaultId: string): Promise<Review[]>;
  addReview(vaultId: string, rating: number, body: string): Promise<Review>;

  // Buying
  getLibrary(): Promise<Purchase[]>;
  hasAccess(vaultId: string): Promise<boolean>;
  claimFreeVault(vaultId: string): Promise<void>;
  /** Returns the payment server's hosted Razorpay checkout URL to open in the browser. */
  createCheckout(vaultId: string): Promise<{ url: string }>;
  /** Short-lived download URL for the vault zip. Caller must have access. */
  getDownloadUrl(vaultId: string): Promise<string>;

  // Selling
  getMyVaults(): Promise<Vault[]>;
  getSellerStats(): Promise<SellerStats>;
  saveVault(input: VaultInput, id?: string): Promise<Vault>;
  setVaultStatus(id: string, status: VaultStatus): Promise<void>;
  deleteVault(id: string): Promise<void>;
  uploadCover(localUri: string): Promise<string>;
  uploadVaultFile(localUri: string, fileName: string): Promise<UploadedFile>;
  /** Marks the user as a seller and creates their Razorpay Route linked account from the given details. */
  setupPayouts(details: PayoutDetails): Promise<{ status: PayoutStatus }>;
  /** Re-checks Razorpay activation and syncs the profile. */
  refreshPayoutStatus(): Promise<{ status: PayoutStatus }>;
}
