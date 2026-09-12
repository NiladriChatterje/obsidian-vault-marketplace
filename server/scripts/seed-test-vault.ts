/**
 * Seeds one publishable vault into Sanity, owned by a real Supabase user, so a payment can
 * be tested end to end with a second account as the buyer.
 *
 *   node server/scripts/seed-test-vault.ts <seller-user-id> [price-in-rupees]
 *
 * Unlike seed-sanity.ts, which seeds the eight sample listings under fictional sellers, this
 * attaches the vault to an account that can actually sign in, so the seller dashboard, the
 * payout gate and the ledger all have a real person behind them.
 *
 * Ids are deterministic, so re-running updates the same vault rather than making another.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

const { parseNote } = await import('../src/sanity/markdown.ts');
const { requireWriteToken, sanity, useSanityClientFactory, SANITY_DATASET, SANITY_PROJECT_ID } = await import('../src/sanity/client.ts');
const { createClient } = await import('@sanity/client');
const { minPriceCents, platformFee } = await import('../src/config.ts');

/** Which note opens first, and which are readable without buying. */
const SAMPLE_ENTRY_NOTE = 'Home.md';
const SAMPLE_PREVIEW_NOTES = [SAMPLE_ENTRY_NOTE, 'Getting started.md'];

const sellerUserId = process.argv[2];
if (!sellerUserId) {
  console.error('Usage: node server/scripts/seed-test-vault.ts <seller-user-id> [price-in-rupees]');
  process.exit(1);
}

const floor = minPriceCents();
const priceCents = process.argv[3] ? Math.round(Number(process.argv[3]) * 100) : 49900;
if (priceCents < floor) {
  console.error(`Price must be at least ₹${Math.round(floor / 100)}; below that the payment fees cost more than the sale earns.`);
  process.exit(1);
}

useSanityClientFactory(createClient);
requireWriteToken();
const client = sanity();

const vaultId = `vault-test-${sellerUserId.slice(0, 8)}`;
const sellerId = `seller-${sellerUserId}`;
const bundle = `test-${sellerUserId.slice(0, 8)}`;

const notes: Record<string, string> = {
  'Home.md': `---\ntags: [start-here]\n---\n# Test Vault\n\n> A vault for testing the checkout end to end.\n\nThis note is readable before buying, so you can see the preview gate working.\n\n## Inside\n- [[Getting started]]\n- [[Notes/Locked note]]\n`,
  'Getting started.md': `# Getting started\n\n1. Unzip into your Obsidian vaults folder.\n2. Open [[Home]].\n\nThis note is also a preview, readable without buying.\n\n#setup`,
  'Notes/Locked note.md': `# Locked note\n\nIf you can read this, the purchase went through: this note is only served to owners.\n\n#paid`,
};

console.log(`Seeding ${SANITY_PROJECT_ID}/${SANITY_DATASET}`);
console.log(`  seller : ${sellerUserId}`);
console.log(`  vault  : ${vaultId} at ₹${priceCents / 100}`);

const tx = client.transaction();

tx.createOrReplace({
  _id: sellerId,
  _type: 'seller',
  userId: sellerUserId,
  username: process.env.TEST_SELLER_USERNAME || 'niladri2000',
  displayName: process.env.TEST_SELLER_NAME || 'Niladri',
});

let sizeBytes = 0;
let order = 0;
for (const [p, content] of Object.entries(notes)) {
  const meta = parseNote(p, content);
  const bytes = Buffer.byteLength(content);
  sizeBytes += bytes;
  tx.createOrReplace({
    _id: `note-${vaultId}-${p.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
    _type: 'note',
    vault: { _type: 'reference', _ref: vaultId, _weak: true },
    bundle,
    path: p,
    title: meta.title,
    folder: meta.folder,
    content,
    frontmatter: JSON.stringify(meta.frontmatter),
    tags: meta.tags,
    links: meta.links,
    isPreview: SAMPLE_PREVIEW_NOTES.includes(p),
    sizeBytes: bytes,
    order: order++,
  });
}

tx.createOrReplace({
  _id: vaultId,
  _type: 'vault',
  title: 'Test Vault (do not buy unless testing)',
  slug: { _type: 'slug', current: vaultId },
  tagline: 'A deliberately cheap vault used to test the checkout end to end.',
  description:
    'This listing exists to test payments. It contains three notes: two readable before buying and one that only unlocks after purchase, so a successful checkout is obvious.',
  category: 'pkm',
  tags: ['test'],
  seller: { _type: 'reference', _ref: sellerId },
  screenshots: [],
  featured: false,
  plugins: [],
  version: '1.0',
  noteCount: Object.keys(notes).length,
  sizeBytes,
  entryNote: SAMPLE_ENTRY_NOTE,
  bundle,
  priceCents,
  currency: 'INR',
  status: 'published',
  downloads: 0,
  ratingAvg: 0,
  ratingCount: 0,
});

const result = await tx.commit();
console.log(`Done: ${result.results.length} documents written.`);
console.log();
console.log(`  buyer pays        ₹${priceCents / 100}`);
console.log(`  platform keeps    ₹${(platformFee(priceCents, 'IN') / 100).toFixed(2)} commission`);
console.log(`  seller accrues    ₹${((priceCents - platformFee(priceCents, 'IN')) / 100).toFixed(2)}`);
console.log();
console.log(`  open /vault/${vaultId}`);
