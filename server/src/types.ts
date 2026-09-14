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
