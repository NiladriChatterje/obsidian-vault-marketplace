// Records purchases when Stripe confirms payment.
// Deploy with --no-verify-jwt: Stripe calls this without a Supabase session.
//   supabase functions deploy stripe-webhook --no-verify-jwt
import { adminClient, json, stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !secret) return json({ error: 'Missing signature' }, 400);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch (e) {
    return json({ error: `Invalid signature: ${e instanceof Error ? e.message : e}` }, 400);
  }

  const sb = adminClient();

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.payment_status !== 'paid') break;
      const vaultId = session.metadata?.vault_id;
      const buyerId = session.metadata?.buyer_id;
      if (!vaultId || !buyerId) break;
      const { error } = await sb.from('purchases').upsert(
        {
          vault_id: vaultId,
          buyer_id: buyerId,
          amount_cents: session.amount_total ?? 0,
          fee_cents: Number(session.metadata?.fee_cents ?? 0),
          stripe_session_id: session.id,
          stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
        },
        { onConflict: 'vault_id,buyer_id' }
      );
      if (error) {
        console.error(error);
        return json({ error: error.message }, 500);
      }
      break;
    }
    case 'account.updated': {
      // Seller finished (or lost) onboarding on Stripe Express.
      const account = event.data.object;
      await sb
        .from('profiles')
        .update({ stripe_onboarded: !!account.charges_enabled && !!account.payouts_enabled })
        .eq('stripe_account_id', account.id);
      break;
    }
    default:
      break;
  }

  return json({ received: true });
});
