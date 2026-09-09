import { defineField, defineType } from 'sanity';

/** Mirrors CATEGORIES in src/types.ts. */
export const CATEGORY_OPTIONS = [
  { title: 'PKM Systems', value: 'pkm' },
  { title: 'Productivity', value: 'productivity' },
  { title: 'Students', value: 'students' },
  { title: 'Research', value: 'research' },
  { title: 'Writing', value: 'writing' },
  { title: 'Developers', value: 'developers' },
  { title: 'Business', value: 'business' },
  { title: 'Life & Journaling', value: 'life' },
  { title: 'Template Packs', value: 'templates' },
  { title: 'Themes & Setups', value: 'themes' },
];

export const vault = defineType({
  name: 'vault',
  title: 'Vault',
  type: 'document',
  groups: [
    { name: 'listing', title: 'Listing', default: true },
    { name: 'contents', title: 'Contents' },
    { name: 'commerce', title: 'Price & status' },
    { name: 'stats', title: 'Stats' },
  ],
  fields: [
    defineField({ name: 'title', type: 'string', group: 'listing', validation: (r) => r.required().min(3).max(80) }),
    defineField({
      name: 'slug',
      type: 'slug',
      group: 'listing',
      options: { source: 'title', maxLength: 60 },
      validation: (r) => r.required(),
    }),
    defineField({ name: 'tagline', type: 'string', group: 'listing', description: 'One sentence: who it is for.', validation: (r) => r.max(120) }),
    defineField({ name: 'description', type: 'text', rows: 10, group: 'listing', description: 'Markdown. What is inside, how to get started.' }),
    defineField({
      name: 'category',
      type: 'string',
      group: 'listing',
      options: { list: CATEGORY_OPTIONS, layout: 'dropdown' },
      validation: (r) => r.required(),
    }),
    defineField({ name: 'tags', type: 'array', of: [{ type: 'string' }], group: 'listing', options: { layout: 'tags' }, validation: (r) => r.max(10) }),
    defineField({
      name: 'seller',
      type: 'reference',
      to: [{ type: 'seller' }],
      group: 'listing',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'cover', title: 'Cover image', type: 'image', group: 'listing', options: { hotspot: true } }),
    defineField({ name: 'screenshots', type: 'array', of: [{ type: 'url' }], group: 'listing' }),
    defineField({ name: 'featured', type: 'boolean', group: 'listing', initialValue: false, description: 'Shows in the home carousel.' }),

    defineField({
      name: 'plugins',
      title: 'Community plugins used',
      type: 'array',
      of: [{ type: 'string' }],
      group: 'contents',
      options: { layout: 'tags' },
    }),
    defineField({ name: 'version', type: 'string', group: 'contents', initialValue: '1.0' }),
    defineField({
      name: 'noteCount',
      type: 'number',
      group: 'contents',
      readOnly: true,
      description: 'Maintained by the server when notes are uploaded.',
    }),
    defineField({ name: 'sizeBytes', type: 'number', group: 'contents', readOnly: true }),
    defineField({
      name: 'entryNote',
      title: 'Start-here note',
      type: 'string',
      group: 'contents',
      description: 'Path of the note buyers should open first, e.g. "Home.md".',
    }),
    defineField({
      name: 'bundle',
      title: 'Upload bundle id',
      type: 'string',
      group: 'contents',
      readOnly: true,
      description: 'Id of the last zip upload whose notes belong to this vault.',
    }),

    defineField({
      name: 'priceCents',
      title: 'Price (minor units, 0 = free)',
      type: 'number',
      group: 'commerce',
      initialValue: 0,
      validation: (r) => r.required().min(0).integer().custom((v) => (v === 0 || (v ?? 0) >= 4900 ? true : 'Paid vaults start at 4900 (₹49)')),
    }),
    defineField({ name: 'currency', type: 'string', group: 'commerce', initialValue: 'INR', options: { list: ['INR', 'USD', 'EUR'] } }),
    defineField({
      name: 'status',
      type: 'string',
      group: 'commerce',
      initialValue: 'draft',
      options: { list: ['draft', 'published', 'unlisted'], layout: 'radio' },
      validation: (r) =>
        r.required().custom((status, ctx) => {
          const doc = ctx.document as { noteCount?: number } | undefined;
          return status === 'published' && !(doc?.noteCount && doc.noteCount > 0) ? 'Upload the vault notes before publishing' : true;
        }),
    }),

    defineField({ name: 'downloads', type: 'number', group: 'stats', initialValue: 0, readOnly: true }),
    defineField({ name: 'ratingAvg', type: 'number', group: 'stats', initialValue: 0, readOnly: true }),
    defineField({ name: 'ratingCount', type: 'number', group: 'stats', initialValue: 0, readOnly: true }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'tagline', status: 'status', price: 'priceCents', media: 'cover' },
    prepare: ({ title, subtitle, status, price, media }) => ({
      title: `${title ?? 'Untitled'}${status !== 'published' ? ` · ${status}` : ''}`,
      subtitle: `${price ? `₹${(price / 100).toFixed(0)}` : 'Free'}${subtitle ? ` — ${subtitle}` : ''}`,
      media,
    }),
  },
  orderings: [
    { title: 'Downloads', name: 'downloads', by: [{ field: 'downloads', direction: 'desc' }] },
    { title: 'Newest', name: 'newest', by: [{ field: '_createdAt', direction: 'desc' }] },
  ],
});
