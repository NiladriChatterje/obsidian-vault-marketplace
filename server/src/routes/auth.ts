/**
 * Signing in, in two steps.
 *
 *   POST /auth/sign-in/start   { email, password }      -> { challengeId, expiresInSeconds }
 *   POST /auth/sign-in/verify  { challengeId, code }    -> { tokenHash }
 *
 * These are the only unauthenticated POST routes on the server, for the obvious reason that
 * the caller has no session yet. `tokenHash` is not a session: the browser hands it to
 * Supabase, which mints one. See signin-otp.ts for why it works that way.
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO } from '../config.ts';
import { SignInError, startSignIn, verifySignIn } from '../signin-otp.ts';

const NO_DEMO = 'Demo mode signs in without a server. This route is for the real thing.';

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>(
    '/auth/sign-in/start',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', maxLength: 320 }, password: { type: 'string', maxLength: 512 } },
        },
      },
    },
    async (req, reply) => {
      if (IS_DEMO) return reply.code(400).send({ error: NO_DEMO });
      try {
        return await startSignIn(req.body.email ?? '', req.body.password ?? '', req.log);
      } catch (e) {
        if (e instanceof SignInError) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
    }
  );

  app.post<{ Body: { challengeId?: string; code?: string } }>(
    '/auth/sign-in/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['challengeId', 'code'],
          properties: { challengeId: { type: 'string', maxLength: 64 }, code: { type: 'string', maxLength: 12 } },
        },
      },
    },
    async (req, reply) => {
      if (IS_DEMO) return reply.code(400).send({ error: NO_DEMO });
      try {
        return await verifySignIn(req.body.challengeId ?? '', req.body.code ?? '');
      } catch (e) {
        if (e instanceof SignInError) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
    }
  );
}
