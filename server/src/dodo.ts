/**
 * Dodo Payments, the merchant of record.
 *
 * Dodo is the legal seller to the buyer: it takes the payment in whatever currency and
 * method suits them, registers and remits VAT / sales tax in every jurisdiction, carries
 * the chargeback, and settles the net to our bank as an inward remittance for export of
 * services. The platform never holds anyone else's money, which is the whole reason this
 * replaced Route.
 *
 * A checkout references a Dodo *product*, so each vault needs one on their side. They are
 * created on demand and cached in public.dodo_products; a price change re-pushes rather
 * than creating a second product for the same vault.
 */
import DodoPayments from 'dodopayments';
import { Webhook } from 'standardwebhooks';
import { cfg } from './config.ts';
import { admin } from './supabase.ts';
import type { Vault } from './types.ts';

export const DODO_ENABLED = !!cfg.dodo.apiKey;

let client: DodoPayments | null = null;

export function dodo(): DodoPayments {
  if (!DODO_ENABLED) throw new Error('Dodo Payments is not configured (DODO_API_KEY).');
  client ??= new DodoPayments({ bearerToken: cfg.dodo.apiKey, environment: cfg.dodo.live ? 'live_mode' : 'test_mode' });
  return client;
}

/** Dodo errors carry the useful text under different keys depending on the failure. */
export function dodoError(e: unknown): string {
  const err = e as { error?: { message?: string }; message?: string };
  return err?.error?.message ?? err?.message ?? 'Dodo Payments request failed';
}

/**
 * The Dodo product for a vault, created on first sale and kept in step with the listing.
 * Digital downloads are all one tax category, so the only thing that varies is the price.
 */
export async function productForVault(vault: Vault): Promise<string> {
  const db = admin();
  const currency = (vault.currency || 'INR').toUpperCase();
  const { data: cached } = await db.from('dodo_products').select('*').eq('vault_id', vault.id).maybeSingle();

  if (cached) {
    if (cached.price_cents !== vault.priceCents || cached.currency !== currency) {
      // The seller repriced. Update in place so old checkout links cannot charge the old price.
      await dodo().products.update(cached.product_id, {
        price: { type: 'one_time_price', currency: currency as never, price: vault.priceCents },
      });
      await db
        .from('dodo_products')
        .update({ price_cents: vault.priceCents, currency, updated_at: new Date().toISOString() })
        .eq('vault_id', vault.id);
    }
    return cached.product_id;
  }

  const product = await dodo().products.create({
    name: vault.title,
    description: vault.tagline || undefined,
    // Obsidian vaults are downloadable files, not software or courses.
    tax_category: 'digital_products',
    price: { type: 'one_time_price', currency: currency as never, price: vault.priceCents },
  });

  // onConflict so two buyers hitting checkout at once cannot leave a duplicate row; the
  // stray Dodo product is harmless and unreferenced.
  await db
    .from('dodo_products')
    .upsert({ vault_id: vault.id, product_id: product.product_id, price_cents: vault.priceCents, currency }, { onConflict: 'vault_id' });
  return product.product_id;
}

/**
 * Verifies a Dodo webhook. Standard Webhooks signs `id.timestamp.body` and sends the parts
 * in the webhook-* headers, so the raw body has to survive Fastify's parser untouched.
 */
export function verifyDodoWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  if (!cfg.dodo.webhookSecret) return false;
  const header = (name: string): string => {
    const v = headers[name];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };
  try {
    new Webhook(cfg.dodo.webhookSecret).verify(rawBody, {
      'webhook-id': header('webhook-id'),
      'webhook-timestamp': header('webhook-timestamp'),
      'webhook-signature': header('webhook-signature'),
    });
    return true;
  } catch {
    return false;
  }
}
