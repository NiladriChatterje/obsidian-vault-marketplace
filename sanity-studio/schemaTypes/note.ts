import { defineField, defineType } from 'sanity';

/** One markdown file inside a vault. `path` is the file's location relative to the vault root. */
export const note = defineType({
  name: 'note',
  title: 'Note',
  type: 'document',
  fields: [
    defineField({
      name: 'vault',
      type: 'reference',
      to: [{ type: 'vault' }],
      weak: true,
      description: 'Empty while the upload is still being attached to a listing.',
    }),
    defineField({
      name: 'bundle',
      title: 'Upload bundle id',
      type: 'string',
      readOnly: true,
      description: 'Groups the notes of one zip upload; the server sets it.',
    }),
    defineField({
      name: 'path',
      type: 'string',
      description: 'Relative path with extension, e.g. "Templates/Daily note.md".',
      validation: (r) => r.required().regex(/^[^/].*\.(md|markdown|canvas)$/i, { name: 'markdown path' }),
    }),
    defineField({ name: 'title', type: 'string', description: 'Usually the filename without extension, or the first H1.' }),
    defineField({ name: 'folder', type: 'string', readOnly: true, description: 'Directory part of the path ("" for root).' }),
    defineField({
      name: 'content',
      title: 'Markdown',
      type: 'text',
      rows: 30,
      description: 'Full file body including frontmatter.',
    }),
    defineField({
      name: 'frontmatter',
      title: 'Frontmatter (JSON)',
      type: 'text',
      rows: 4,
      readOnly: true,
      description: 'Parsed YAML frontmatter as JSON, extracted by the server.',
    }),
    defineField({ name: 'tags', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' }, description: 'From frontmatter and inline #tags.' }),
    defineField({
      name: 'links',
      title: 'Wikilinks',
      type: 'array',
      of: [{ type: 'string' }],
      readOnly: true,
      description: 'Targets of [[...]] links found in the body.',
    }),
    defineField({
      name: 'isPreview',
      title: 'Free preview',
      type: 'boolean',
      initialValue: false,
      description: 'Visible to buyers before purchase (and to the MCP server without a purchase).',
    }),
    defineField({ name: 'sizeBytes', type: 'number', readOnly: true }),
    defineField({ name: 'order', type: 'number', hidden: true }),
  ],
  preview: {
    select: { title: 'title', path: 'path', preview: 'isPreview', vault: 'vault.title' },
    prepare: ({ title, path, preview, vault }) => ({
      title: title || path,
      subtitle: `${vault ? `${vault} · ` : ''}${path}${preview ? ' · preview' : ''}`,
    }),
  },
  orderings: [{ title: 'Path', name: 'path', by: [{ field: 'path', direction: 'asc' }] }],
});
