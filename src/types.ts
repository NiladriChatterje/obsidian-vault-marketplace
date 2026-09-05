export const CATEGORIES = [
  { slug: 'pkm', label: 'PKM Systems', emoji: '🧠' },
  { slug: 'productivity', label: 'Productivity', emoji: '✅' },
  { slug: 'students', label: 'Students', emoji: '🎓' },
  { slug: 'research', label: 'Research', emoji: '🔬' },
  { slug: 'writing', label: 'Writing', emoji: '✍️' },
  { slug: 'developers', label: 'Developers', emoji: '💻' },
  { slug: 'business', label: 'Business', emoji: '💼' },
  { slug: 'life', label: 'Life & Journaling', emoji: '🌱' },
  { slug: 'templates', label: 'Template Packs', emoji: '🧩' },
  { slug: 'themes', label: 'Themes & Setups', emoji: '🎨' },
] as const;

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
  stripeAccountId?: string | null;
  stripeOnboarded: boolean;
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
  accentColor: string;
  emoji: string;
  screenshots: string[];
  plugins: string[];
  noteCount: number;
  sizeBytes: number;
  version: string;
  /** Private storage path of the vault zip. */
  filePath?: string | null;
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
  | 'accentColor'
  | 'emoji'
  | 'plugins'
  | 'noteCount'
  | 'version'
> & {
  coverUrl?: string | null;
  screenshots?: string[];
  filePath?: string | null;
  sizeBytes?: number;
  status?: VaultStatus;
};

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
}

export type SortMode = 'new' | 'popular' | 'top';

export interface ListVaultsParams {
  category?: CategorySlug;
  search?: string;
  sort?: SortMode;
  featured?: boolean;
  freeOnly?: boolean;
  limit?: number;
}
