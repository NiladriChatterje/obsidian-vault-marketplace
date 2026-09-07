import { defineField, defineType } from 'sanity';

/** A non-markdown file shipped with the vault (images, PDFs, .obsidian config, CSS snippets). */
export const attachment = defineType({
  name: 'attachment',
  title: 'Attachment',
  type: 'document',
  fields: [
    defineField({ name: 'vault', type: 'reference', to: [{ type: 'vault' }], weak: true }),
    defineField({ name: 'bundle', type: 'string', readOnly: true }),
    defineField({ name: 'path', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'file', type: 'file', options: { storeOriginalFilename: true } }),
    defineField({ name: 'mimeType', type: 'string', readOnly: true }),
    defineField({ name: 'sizeBytes', type: 'number', readOnly: true }),
  ],
  preview: {
    select: { title: 'path', subtitle: 'vault.title' },
  },
});
