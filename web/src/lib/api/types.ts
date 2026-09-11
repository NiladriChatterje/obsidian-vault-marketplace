import type {
  ListVaultsParams,
  PayoutDetails,
  Profile,
  Purchase,
  Review,
  SellerStats,
  Vault,
  VaultInput,
  VaultNote,
  VaultNoteContent,
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
  /** False when the username is already taken, so sign-up can fail before the account exists. */
  isUsernameAvailable(username: string): Promise<boolean>;
  /** Emails a password-reset link. Resolves for unknown addresses too, so it cannot be used to probe for accounts. */
  sendPasswordReset(email: string): Promise<void>;
  /** Sets a new password for the user the current session belongs to (a reset link, or a signed-in user). */
  updatePassword(password: string): Promise<void>;
  /** Sends the sign-up confirmation email again. */
  resendConfirmation(email: string): Promise<void>;
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, 'displayName' | 'bio' | 'username' | 'isSeller'>>): Promise<Profile>;
  /** Null until the seller says where their share should go. Paid listings are gated on it. */
  getPayoutDetails(): Promise<{ details: PayoutDetails | null; currencies: string[] }>;
  savePayoutDetails(details: PayoutDetails): Promise<PayoutDetails>;

  // Catalog
  listVaults(params?: ListVaultsParams): Promise<Vault[]>;
  getVault(id: string): Promise<Vault | null>;
  getSellerVaults(sellerId: string): Promise<Vault[]>;
  getReviews(vaultId: string): Promise<Review[]>;
  /** Files inside the vault (metadata only). Empty when the catalog has no note index. */
  getVaultNotes(vaultId: string): Promise<VaultNote[]>;
  /** One note's markdown. Preview notes are public; the rest need ownership. */
  getNote(vaultId: string, path: string): Promise<VaultNoteContent>;
  addReview(vaultId: string, rating: number, body: string): Promise<Review>;

  // Buying
  getLibrary(): Promise<Purchase[]>;
  hasAccess(vaultId: string): Promise<boolean>;
  claimFreeVault(vaultId: string): Promise<void>;
  /** Returns the provider's hosted checkout URL to open in the browser. */
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
}
