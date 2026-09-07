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
  /** Razorpay Route linked account (acc_...). */
  razorpayAccountId?: string | null;
  /** True once Razorpay has activated the linked account for settlements. */
  payoutsEnabled: boolean;
  createdAt: string;
}

/** KYC + bank details a seller submits once to receive Razorpay Route payouts. */
export interface PayoutDetails {
  legalName: string;
  phone: string;
  pan: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

/** 'none' = not a seller yet, 'pending' = under Razorpay review, 'activated' = payouts flowing. */
export type PayoutStatus = 'none' | 'pending' | 'activated';

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
