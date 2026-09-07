// Marks the caller as a seller and returns a Stripe Express onboarding link.
// Safe to call repeatedly: reuses the existing connected account.
import { adminClient, corsHeaders, json, resolveRedirectOrigin, stripe, userClient } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const origin = resolveRedirectOrigin(await req.json().catch(() => ({})));
    const sb = userClient(req);
    const { data: auth } = await sb.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const admin = adminClient();
    const { data: profile, error } = await admin.from('profiles').select('*').eq('id', user.id).single();
    if (error || !profile) return json({ error: 'Profile not found' }, 404);

    let accountId: string | null = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email ?? undefined,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { user_id: user.id },
      });
      accountId = account.id;
    }

    await admin.from('profiles').update({ is_seller: true, stripe_account_id: accountId }).eq('id', user.id);

    if (profile.stripe_onboarded) return json({ url: null, onboarded: true });

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: `${origin}/sell?onboarding=done`,
      refresh_url: `${origin}/sell?onboarding=refresh`,
    });

    return json({ url: link.url, onboarded: false });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
