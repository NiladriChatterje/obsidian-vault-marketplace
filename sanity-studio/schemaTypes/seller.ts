import { defineField, defineType } from 'sanity';

/** Public seller profile. `userId` links it to the Supabase auth user who owns the listings. */
export const seller = defineType({
  name: 'seller',
  title: 'Seller',
  type: 'document',
  fields: [
    defineField({ name: 'userId', title: 'Auth user id', type: 'string', validation: (r) => r.required(), readOnly: true }),
    defineField({ name: 'username', type: 'string', validation: (r) => r.required().regex(/^[a-z0-9_.]{3,24}$/, { name: 'username' }) }),
    defineField({ name: 'displayName', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'bio', type: 'text', rows: 3 }),
    defineField({ name: 'avatarUrl', type: 'url' }),
  ],
  preview: {
    select: { title: 'displayName', subtitle: 'username' },
    prepare: ({ title, subtitle }) => ({ title, subtitle: `@${subtitle}` }),
  },
});
