export const CATEGORIES = [
  { slug: 'pkm', label: 'PKM Systems', icon: 'git-network-outline' },
  { slug: 'productivity', label: 'Productivity', icon: 'checkbox-outline' },
  { slug: 'students', label: 'Students', icon: 'school-outline' },
  { slug: 'research', label: 'Research', icon: 'flask-outline' },
  { slug: 'writing', label: 'Writing', icon: 'pencil-outline' },
  { slug: 'developers', label: 'Developers', icon: 'code-slash-outline' },
  { slug: 'business', label: 'Business', icon: 'briefcase-outline' },
  { slug: 'life', label: 'Life & Journaling', icon: 'leaf-outline' },
  { slug: 'templates', label: 'Template Packs', icon: 'copy-outline' },
  { slug: 'themes', label: 'Themes & Setups', icon: 'color-palette-outline' },
] as const;

export type CategoryIcon = (typeof CATEGORIES)[number]['icon'];

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}

export type VaultStatus = 'draft' | 'published' | 'unlisted';

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isSeller: boolean;
  createdAt: string;
}

/**
 * Where a seller's share is sent. Dodo settles to the platform and never pays a seller, so
 * these are the platform's own records, and a paid vault cannot go live without them.
 */
export type PayoutMethod = 'bank' | 'wise' | 'payoneer' | 'paypal';

export interface PayoutDetails {
  /**
   * The region the payout goes to, set by the server from the currency (IN for INR, EU for
   * EUR). Not asked on the form; only read back, to show which fee rate applies.
   */
  country?: string;
  /** ISO 4217. */
  currency: string;
  method: PayoutMethod;
  accountName: string;
  /** Account number or IBAN for a bank; the account email otherwise. */
  accountRef: string;
  /** IFSC, sort code, routing number or SWIFT/BIC, whichever the country uses. */
  bankCode?: string | null;
  notes?: string | null;
}

export type SellerSummary = Pick<Profile, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

export interface Vault {
  id: string;
  sellerId: string;
  seller?: SellerSummary;
  title: string;
  tagline: string;
  description: string;
  category: CategorySlug;
  tags: string[];
  /** 0 means free. */
  priceCents: number;
  currency: string;
  coverUrl?: string | null;
  screenshots: string[];
  plugins: string[];
  noteCount: number;
  sizeBytes: number;
  version: string;
  /** Id of the upload bundle whose notes make up this vault (was: storage path of the zip). */
  filePath?: string | null;
  /** Path of the note buyers should open first, e.g. "Home.md". */
  entryNote?: string | null;
  status: VaultStatus;
  downloads: number;
  ratingAvg: number;
  ratingCount: number;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VaultInput = Pick<
  Vault,
  | 'title'
  | 'tagline'
  | 'description'
  | 'category'
  | 'tags'
  | 'priceCents'
  | 'plugins'
  | 'noteCount'
  | 'version'
> & {
  coverUrl?: string | null;
  screenshots?: string[];
  filePath?: string | null;
  entryNote?: string | null;
  sizeBytes?: number;
  status?: VaultStatus;
};

/** One markdown file inside a vault (metadata only; the body is fetched separately). */
export interface VaultNote {
  path: string;
  title: string;
  folder: string;
  /** Readable before purchase. */
  isPreview: boolean;
  sizeBytes: number;
  tags: string[];
  links: string[];
}

export interface VaultNoteContent extends VaultNote {
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface Purchase {
  id: string;
  vaultId: string;
  buyerId: string;
  amountCents: number;
  feeCents: number;
  createdAt: string;
  vault?: Vault;
}

export interface Review {
  id: string;
  vaultId: string;
  userId: string;
  rating: number;
  body: string;
  createdAt: string;
  author?: SellerSummary;
}

export interface SellerStats {
  grossCents: number;
  feeCents: number;
  netCents: number;
  salesCount: number;
  downloads: number;
  publishedCount: number;
  /** Transferred to the seller so far. Earnings and payouts are separate events. */
  paidOutCents?: number;
  /** Earned but not yet transferred. Negative after a refund on an already-paid sale. */
  outstandingCents?: number;
  /** What they must reach before a transfer is worth its fee. Depends on how they are paid. */
  payoutThresholdCents?: number;
  /** Past its clearing window and payable. */
  availableCents?: number;
  /** Earned, but still inside the buyer's reversal window. */
  holdingCents?: number;
}

export type SortMode = 'new' | 'popular' | 'top';

export interface ListVaultsParams {
  category?: CategorySlug;
  search?: string;
  sort?: SortMode;
  featured?: boolean;
  freeOnly?: boolean;
  limit?: number;
  /** Opaque token from a previous page's `nextCursor`; returns the vaults after it in the same order. */
  cursor?: string;
}

/** One page of the catalog list. `nextCursor` is null on the last page. */
export interface VaultPage {
  items: Vault[];
  nextCursor: string | null;
}

/** What someone says they are here for when they create an account. Sellers are asked where to pay them next. */
export type AccountRole = 'buyer' | 'seller';

/* ---------- who bought what, and what they said ---------- */

/** Someone named on a record: a buyer on a purchase, an author on a review. */
export type UserSummary = SellerSummary;

/** How one vault has sold, across every purchase of it. */
export interface VaultSales {
  vaultId: string;
  /** Paid purchases. */
  sales: number;
  /** Free claims. */
  freeClaims: number;
  /** Distinct people who own it, paid or free. */
  buyers: number;
  /** List price of every paid purchase. */
  grossCents: number;
  /** The platform's commission across them. */
  feeCents: number;
  /** What the seller earned: gross minus commission. */
  netCents: number;
  lastPurchaseAt: string | null;
}

/** One purchase as the seller or the operator sees it. */
export interface PurchaseRecord {
  id: string;
  vaultId: string;
  /** Null when the buyer's profile is gone. */
  buyer: UserSummary | null;
  amountCents: number;
  feeCents: number;
  /** ISO 3166-1 alpha-2, from checkout. Null for free claims and older rows. */
  buyerCountry: string | null;
  createdAt: string;
  /** When the buyer can no longer reverse it. Null on rows older than the clearing window. */
  clearsAt: string | null;
  /** When Dodo paid us for it. Null until then. */
  settledAt: string | null;
}

/** Everything about one vault's buyers and reviewers, for its seller or the operator. */
export interface VaultInsights {
  vaultId: string;
  /** Null when the listing has since been removed from the catalog. */
  vault: Vault | null;
  sales: VaultSales;
  ratingAvg: number;
  ratingCount: number;
  /** How many reviews gave one star, two, and so on: index 0 is one star. */
  ratingBreakdown: [number, number, number, number, number];
  /** Newest first. */
  purchases: PurchaseRecord[];
  /** Newest first. */
  reviews: Review[];
}

/** One line of the operator's dashboard. */
export interface AdminVaultRow {
  vaultId: string;
  vault: Vault | null;
  sales: VaultSales;
}

export interface AdminOverview {
  totals: {
    /** Every purchase row, paid or free. */
    purchases: number;
    /** Paid purchases. */
    sales: number;
    /** Distinct buyers. */
    buyers: number;
    /** Profiles that have turned on selling. */
    sellers: number;
    /** Listings in the catalog, whether or not anyone has bought them. */
    vaults: number;
    grossCents: number;
    feeCents: number;
    netCents: number;
    currency: string;
  };
  /** Most bought first. */
  vaults: AdminVaultRow[];
  /** The latest purchases across the marketplace, newest first, each with its vault's title. */
  recent: (PurchaseRecord & { vaultTitle: string | null })[];
}
