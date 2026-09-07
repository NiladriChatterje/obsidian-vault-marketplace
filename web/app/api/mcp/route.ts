/**
 * MCP endpoint (Streamable HTTP). Clients authenticate with
 *   Authorization: Bearer <token from /connect>
 * and get read-only tools over the vaults they own. See lib/mcp-server.ts.
 */
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { bearerToken, buildServer, resolveUser } from '@/lib/mcp-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One handler per user, reused across requests in this process.
const handlers = new Map<string, McpHttpHandler>();

function handlerFor(userId: string): McpHttpHandler {
  let h = handlers.get(userId);
  if (!h) {
    h = createMcpHandler(() => buildServer(userId), { responseMode: 'json' });
    if (handlers.size >= 200) handlers.delete(handlers.keys().next().value!);
    handlers.set(userId, h);
  }
  return h;
}

function unauthorized(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="vault-market"' },
  });
}

async function handle(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return unauthorized('Missing bearer token. Create one at /connect.');
  let userId: string | null;
  try {
    userId = await resolveUser(token);
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Server error' }), { status: 500 });
  }
  if (!userId) return unauthorized('Invalid or revoked token. Generate a new one at /connect.');
  return handlerFor(userId).fetch(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
