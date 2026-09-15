import type {
  AccountRole,
  AdminOverview,
  ListVaultsParams,
  PayoutDetails,
  Profile,
  Purchase,
  Review,
  SellerStats,
  Vault,
  VaultInput,
  VaultInsights,
  VaultNote,
  VaultNoteContent,
  VaultPage,
  VaultSales,
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
  /** `role` travels with the account so a seller's profile is created as one, even before the email is confirmed. */
  signUp(email: string, password: string, username: string, role?: AccountRole): Promise<{ needsEmailConfirm: boolean }>;
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
  /** Null until the seller says where their share should go. Paid listings are gated on it. The currencies are the ones the server can pay out in. */
  getPayoutDetails(): Promise<{ details: PayoutDetails | null; currencies: string[] }>;
  savePayoutDetails(details: PayoutDetails): Promise<PayoutDetails>;
  /** Whether the signed-in user may open the admin dashboard. False whenever in doubt, including with no server. */
  isAdmin(): Promise<boolean>;

  // Catalog
  listVaults(params?: ListVaultsParams): Promise<VaultPage>;
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

  // Who bought what, and what they said
  /** How each of my listings has sold. */
  getMyInsights(): Promise<VaultSales[]>;
  /** One of my listings: every buyer and every review. */
  getMyVaultInsights(vaultId: string): Promise<VaultInsights>;
  /** Operator only: the whole marketplace at a glance. */
  getAdminOverview(): Promise<AdminOverview>;
  /** Operator only: any vault's buyers and reviews. */
  getAdminVault(vaultId: string): Promise<VaultInsights>;
}
