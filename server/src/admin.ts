/**
 * Who may open the operator's side of the site.
 *
 * Administrators are named in ADMIN_USER_IDS, a comma-separated list of Supabase user ids.
 * There is no admin flag on a profile on purpose: profiles are world readable and edited by
 * their owner, so a flag there would be either visible to everyone or grantable by the
 * person it grants. A list on the server is neither.
 *
 * With the list unset every admin route is closed. An admin surface that defaults to open
 * because a variable was forgotten is worse than one that is unavailable until configured.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IS_DEMO, cfg } from './config.ts';
import { userFromRequest, type AuthUser } from './supabase.ts';

export function isAdminId(userId: string): boolean {
  return cfg.adminUserIds.includes(userId);
}

/** Resolves the caller and refuses anyone not named in ADMIN_USER_IDS. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  // Demo mode has no database, so there is no one to be an administrator of.
  if (IS_DEMO) {
    reply.code(503).send({ error: 'Admin routes need Supabase configured on the server.' });
    return null;
  }
  if (!cfg.adminUserIds.length) {
    reply.code(503).send({ error: 'Admin routes are not enabled. Set ADMIN_USER_IDS on the server.' });
    return null;
  }
  const user = await userFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: 'Not signed in' });
    return null;
  }
  if (!isAdminId(user.id)) {
    reply.code(403).send({ error: 'Not an administrator' });
    return null;
  }
  return user;
}
