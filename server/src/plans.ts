/**
 * Storage plans: how much a seller may keep listed, across all their vaults.
 *
 * The plan catalog is configuration; the `seller_plans` table records only what a seller has
 * (which plan, until when). No row means free, which is most sellers, so the table stays
 * small. Usage is never stored: it is summed from their vaults when it is needed, so there
 * is no second number to drift.
 *
 * A lapsed plan counts as free from `current_period_end` on. Nothing is deleted when that
 * happens; the seller just cannot add or replace a vault until they are under the quota again.
 * Selling the paid plans (Dodo subscriptions) is not wired yet; `setPlan` is how an operator
 * grants one meanwhile.
 */
import { IS_DEMO, cfg } from './config.ts';
import { admin } from './supabase.ts';

export type PlanId = 'free' | 'plus' | 'pro';

export interface Plan {
  id: PlanId;
  label: string;
  quotaBytes: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', label: 'Free', quotaBytes: cfg.plans.freeMb * 1024 * 1024 },
  plus: { id: 'plus', label: 'Plus', quotaBytes: cfg.plans.plusMb * 1024 * 1024 },
  pro: { id: 'pro', label: 'Pro', quotaBytes: cfg.plans.proMb * 1024 * 1024 },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === 'free' || v === 'plus' || v === 'pro';
}

/** The plan a seller is on right now, lapsed ones already folded back to free. */
export async function planFor(userId: string): Promise<Plan> {
  if (IS_DEMO) return PLANS.free;
  const { data, error } = await admin().from('seller_plans').select('plan, quota_bytes, current_period_end').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !isPlanId(data.plan)) return PLANS.free;
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now()) return PLANS.free;
  // The row's quota wins over the catalog's, so a grandfathered or hand-set amount survives a config change.
  return { ...PLANS[data.plan], quotaBytes: Number(data.quota_bytes) || PLANS[data.plan].quotaBytes };
}

export async function quotaFor(userId: string): Promise<number> {
  return (await planFor(userId)).quotaBytes;
}

/** Puts a seller on a plan. `periodEnd` null means it does not lapse on its own. */
export async function setPlan(userId: string, plan: PlanId, periodEnd: string | null = null, subscriptionId: string | null = null): Promise<Plan> {
  const { error } = await admin()
    .from('seller_plans')
    .upsert(
      { user_id: userId, plan, quota_bytes: PLANS[plan].quotaBytes, current_period_end: periodEnd, provider_subscription_id: subscriptionId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(error.message);
  return PLANS[plan];
}
