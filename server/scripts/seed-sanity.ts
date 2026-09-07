/**
 * Seeds the Sanity dataset with the demo sellers and vaults from src/lib/demo-data.ts,
 * each with a handful of markdown notes, so the catalog has content to browse.
 *
 *   node server/scripts/seed-sanity.ts          (needs SANITY_API_TOKEN with Editor rights in .env)
 *
 * Re-running replaces the same documents (ids are deterministic), so it is safe.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

const { DEMO_SELLERS, DEMO_VAULTS } = await import('../../src/lib/demo-data.ts');
const { parseNote } = await import('../../src/lib/sanity/markdown.ts');
const { requireWriteToken, sanity, useSanityClientFactory, SANITY_DATASET, SANITY_PROJECT_ID } = await import('../../src/lib/sanity/client.ts');
const { createClient } = await import('@sanity/client');

useSanityClientFactory(createClient);
requireWriteToken();
const client = sanity();
console.log(`Seeding ${SANITY_PROJECT_ID}/${SANITY_DATASET} with ${DEMO_SELLERS.length} sellers and ${DEMO_VAULTS.length} vaults…`);

const tx = client.transaction();

for (const s of DEMO_SELLERS) {
  tx.createOrReplace({ _id: `seller-${s.id}`, _type: 'seller', userId: s.id, username: s.username, displayName: s.displayName, bio: s.bio ?? undefined });
}

for (const v of DEMO_VAULTS) {
  const bundle = `seed-${v.id}`;
  const notes: Record<string, string> = {
    'Home.md': `---\ntags: [start-here]\n---\n# ${v.title}\n\n> ${v.tagline}\n\n${v.description}\n\n## Start here\n- [[Getting started]]\n- [[About this vault]]\n- [[Templates/Daily note]]\n- [[Templates/Weekly review]]\n`,
    'About this vault.md': `# About this vault\n\n- Version: ${v.version}\n- Plugins: ${v.plugins.join(', ') || 'none'}\n- Tags: ${v.tags.map((t) => `#${t}`).join(' ')}\n\nCreated by ${v.seller?.displayName ?? 'the seller'}.\n`,
    'Getting started.md': `# Getting started\n\n1. Unzip into your Obsidian vaults folder.\n2. Enable the community plugins listed in [[About this vault]].\n3. Open [[Home]] and follow the links.\n\n#setup`,
    'Templates/Daily note.md': `---\ntags: [daily, template]\n---\n# {{date:YYYY-MM-DD}}\n\n## Focus\n- \n\n## Log\n- \n\n## Review\n- What moved? \n- What is stuck? See [[Templates/Weekly review]]\n`,
    'Templates/Weekly review.md': `---\ntags: [weekly, template]\n---\n# Week {{date:ww}}\n\n## Wins\n\n## Lessons\n\n## Next week\n- [ ] \n`,
    ...(v.category === 'developers'
      ? { 'Snippets/Git aliases.md': `# Git aliases\n\n\`\`\`bash\ngit config --global alias.lg "log --oneline --graph"\n\`\`\`\n\n#git #snippet` }
      : { 'Areas/Reading list.md': `# Reading list\n\n- [ ] How to Take Smart Notes\n- [ ] Building a Second Brain\n\n#reading` }),
  };

  let sizeBytes = 0;
  let order = 0;
  for (const [p, content] of Object.entries(notes)) {
    const meta = parseNote(p, content);
    const bytes = Buffer.byteLength(content);
    sizeBytes += bytes;
    tx.createOrReplace({
      _id: `note-${v.id}-${p.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
      _type: 'note',
      vault: { _type: 'reference', _ref: `vault-${v.id}`, _weak: true },
      bundle,
      path: p,
      title: meta.title,
      folder: meta.folder,
      content,
      frontmatter: JSON.stringify(meta.frontmatter),
      tags: meta.tags,
      links: meta.links,
      isPreview: p === 'Home.md' || p === 'Getting started.md',
      sizeBytes: bytes,
      order: order++,
    });
  }

  tx.createOrReplace({
    _id: `vault-${v.id}`,
    _type: 'vault',
    title: v.title,
    slug: { _type: 'slug', current: v.id },
    tagline: v.tagline,
    description: v.description,
    category: v.category,
    tags: v.tags,
    seller: { _type: 'reference', _ref: `seller-${v.sellerId}` },
    coverUrl: v.coverUrl ?? undefined,
    screenshots: v.screenshots,
    featured: v.featured,
    plugins: v.plugins,
    version: v.version,
    noteCount: Object.keys(notes).length,
    sizeBytes,
    entryNote: 'Home.md',
    bundle,
    priceCents: v.priceCents,
    currency: v.currency,
    status: 'published',
    downloads: v.downloads,
    ratingAvg: v.ratingAvg,
    ratingCount: v.ratingCount,
  });
}

const result = await tx.commit();
console.log(`Done: ${result.results.length} documents written.`);
