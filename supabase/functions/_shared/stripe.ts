import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

export const PLATFORM_FEE_PERCENT = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? 15);

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2025-08-27.basil',
  httpClient: Stripe.createFetchHttpClient(),
});

/** Client acting as the calling user (respects RLS). */
export function userClient(req: Request) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

/** Privileged client for webhook writes. Never expose to the app. */
export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Resolves where Stripe should redirect afterwards. Accepts the legacy
 * `redirectScheme` (deep link) or a full `redirectOrigin` such as
 * `https://vault.market`. http(s) origins must be listed in the
 * ALLOWED_REDIRECT_ORIGINS secret (comma separated) when it is set.
 */
export function resolveRedirectOrigin(body: { redirectOrigin?: string; redirectScheme?: string }): string {
  const origin = body.redirectOrigin ?? `${body.redirectScheme ?? 'vaultmarket'}:/`;
  if (/^https?:\/\//.test(origin)) {
    const allowed = (Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) throw new Error('Redirect origin is not allowed');
    return origin.replace(/\/$/, '');
  }
  if (!/^[a-z][a-z0-9+.-]*:\/$/.test(origin)) throw new Error('Invalid redirect origin');
  return origin;
}
