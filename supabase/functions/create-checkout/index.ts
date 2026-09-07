// Creates a Stripe Checkout session for a paid vault.
// Destination charge: buyer pays the platform, Stripe forwards the seller's share
// to their connected account and keeps PLATFORM_FEE_PERCENT for us.
import { PLATFORM_FEE_PERCENT, corsHeaders, json, resolveRedirectOrigin, stripe, userClient } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const { vaultId } = body;
    if (!vaultId) return json({ error: 'vaultId is required' }, 400);
    const origin = resolveRedirectOrigin(body);

    const sb = userClient(req);
    const { data: auth } = await sb.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { data: vault, error } = await sb
      .from('vaults')
      .select('id, title, tagline, price_cents, currency, status, seller_id, seller:profiles!vaults_seller_id_fkey(stripe_account_id, stripe_onboarded)')
      .eq('id', vaultId)
      .single();
    if (error || !vault) return json({ error: 'Vault not found' }, 404);
    if (vault.status !== 'published') return json({ error: 'Vault is not available' }, 400);
    if (vault.price_cents <= 0) return json({ error: 'Use claim_free_vault for free vaults' }, 400);
    if (vault.seller_id === user.id) return json({ error: 'You already own this vault' }, 400);

    const seller = Array.isArray(vault.seller) ? vault.seller[0] : vault.seller;
    if (!seller?.stripe_account_id || !seller.stripe_onboarded) {
      return json({ error: 'This seller has not finished payout setup yet' }, 400);
    }

    const { data: existing } = await sb.from('purchases').select('id').eq('vault_id', vaultId).eq('buyer_id', user.id).maybeSingle();
    if (existing) return json({ error: 'You already own this vault' }, 400);

    const fee = Math.round((vault.price_cents * PLATFORM_FEE_PERCENT) / 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: vault.currency.toLowerCase(),
            unit_amount: vault.price_cents,
            product_data: { name: vault.title, description: vault.tagline || undefined },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: fee,
        transfer_data: { destination: seller.stripe_account_id },
      },
      metadata: { vault_id: vault.id, buyer_id: user.id, fee_cents: String(fee) },
      success_url: `${origin}/checkout-result?status=success&vault=${vault.id}`,
      cancel_url: `${origin}/checkout-result?status=cancelled&vault=${vault.id}`,
    });

    return json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
