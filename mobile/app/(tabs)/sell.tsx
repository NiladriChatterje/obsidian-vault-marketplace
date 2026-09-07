import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaultRow } from '../../../src/components/VaultCard';
import { Button, Card, EmptyState, ErrorBox, Loading, SectionTitle } from '../../../src/components/ui';
import { useAsync } from '../../../src/hooks/useAsync';
import { api } from '../../../src/lib/api';
import { PLATFORM_FEE_PERCENT } from '../../../src/lib/config';
import { formatCount, formatPrice } from '../../../src/lib/format';
import { useAuth } from '../../../src/store/auth';
import { colors, radius, spacing } from '../../../src/theme';
import type { Vault, VaultStatus } from '../../../src/types';

export default function SellScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile, isDemo } = useAuth();
  const isSeller = !!profile?.isSeller;

  const vaults = useAsync(() => (user && isSeller ? api.getMyVaults() : Promise.resolve([])), [user?.id, isSeller]);
  const stats = useAsync(() => (user && isSeller ? api.getSellerStats() : Promise.resolve(null)), [user?.id, isSeller]);
  const [checking, setChecking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user && isSeller) {
        vaults.refresh();
        stats.refresh();
        // Razorpay reviews linked accounts asynchronously; sync the flag whenever the tab is opened.
        if (!profile?.payoutsEnabled && !isDemo) api.refreshPayoutStatus().then(refreshProfile).catch(() => {});
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, isSeller, profile?.payoutsEnabled])
  );

  const onBecomeSeller = () => {
    router.push(user ? '/sell/payouts' : '/auth');
  };

  const onCheckStatus = async () => {
    setChecking(true);
    try {
      const { status } = await api.refreshPayoutStatus();
      await refreshProfile();
      if (status !== 'activated') Alert.alert('Still under review', 'Razorpay is verifying your details. Free vaults can be published meanwhile.');
    } catch (e) {
      Alert.alert('Could not check', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const toggleStatus = async (v: Vault) => {
    const next: VaultStatus = v.status === 'published' ? 'unlisted' : 'published';
    if (next === 'published' && !v.filePath) {
      Alert.alert('Upload the vault first', 'A listing needs a .zip file before it can be published.');
      return;
    }
    try {
      await api.setVaultStatus(v.id, next);
      await vaults.refresh();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const onDelete = (v: Vault) => {
    Alert.alert('Delete listing?', `"${v.title}" will be removed. Buyers keep access to what they already bought.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await api.deleteVault(v.id);
          await vaults.refresh();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Sell</Text>

        {!isSeller ? (
          <>
            <Text style={styles.subtitle}>Turn the vault you already maintain into income.</Text>
            <Card style={{ gap: spacing.lg, marginTop: spacing.lg }}>
              <Perk icon="cash-outline" title={`Keep ${100 - PLATFORM_FEE_PERCENT}% of every sale`} body={`We take a flat ${PLATFORM_FEE_PERCENT}% only when you sell. Free vaults cost nothing to list.`} />
              <Perk icon="card-outline" title="Payouts by Razorpay" body="Buyers pay with UPI, cards or netbanking. Your share settles to your bank account through Razorpay Route." />
              <Perk icon="cloud-upload-outline" title="Upload a zip, that is it" body="Export your vault folder as a .zip, add a description and screenshots, publish." />
              <Perk icon="people-outline" title="Built-in audience" body="Buyers browse by category, plugin and tag. Free vaults are a great funnel to paid ones." />
              <Button title={user ? 'Become a seller' : 'Sign in to start selling'} icon="storefront-outline" onPress={onBecomeSeller} />
              {!isDemo ? (
                <Text style={styles.fine}>You will enter your PAN, address and bank account once. Razorpay verifies them in a day or two.</Text>
              ) : null}
            </Card>
          </>
        ) : (
          <>
            {!profile?.payoutsEnabled && !isDemo ? (
              <Pressable onPress={profile?.razorpayAccountId ? onCheckStatus : onBecomeSeller} style={styles.warn}>
                <Ionicons name="time-outline" size={18} color={colors.warning} />
                <Text style={styles.warnText}>
                  {profile?.razorpayAccountId
                    ? checking
                      ? 'Checking with Razorpay...'
                      : 'Payouts pending Razorpay review. Paid vaults unlock once activated. Tap to re-check.'
                    : 'Add your payout details to sell paid vaults. Tap to continue.'}
                </Text>
              </Pressable>
            ) : null}

            {stats.data ? (
              <View style={styles.statsGrid}>
                <StatCard label="Net earnings" value={formatPrice(stats.data.netCents)} accent />
                <StatCard label="Sales" value={String(stats.data.salesCount)} />
                <StatCard label="Downloads" value={formatCount(stats.data.downloads)} />
                <StatCard label="Published" value={String(stats.data.publishedCount)} />
              </View>
            ) : stats.loading ? (
              <Loading />
            ) : null}

            <Button
              title="New listing"
              icon="add"
              onPress={() => router.push({ pathname: '/sell/[id]', params: { id: 'new' } })}
              style={{ marginTop: spacing.lg }}
            />

            <SectionTitle>Your listings</SectionTitle>
            {vaults.error ? <ErrorBox message={vaults.error} onRetry={vaults.refresh} /> : null}
            {vaults.loading && !vaults.data ? <Loading /> : null}
            {vaults.data && vaults.data.length === 0 ? (
              <EmptyState
                icon="cube-outline"
                title="No listings yet"
                message="Create your first listing. You can save it as a draft and publish when the zip is ready."
              />
            ) : null}
            <View style={{ gap: spacing.sm }}>
              {vaults.data?.map((v) => (
                <View key={v.id} style={styles.listing}>
                  <VaultRow
                    vault={v}
                    onPress={() => router.push({ pathname: '/sell/[id]', params: { id: v.id } })}
                    right={<StatusPill status={v.status} />}
                  />
                  <View style={styles.listingActions}>
                    <Button
                      title={v.status === 'published' ? 'Unlist' : 'Publish'}
                      small
                      variant={v.status === 'published' ? 'secondary' : 'success'}
                      onPress={() => toggleStatus(v)}
                    />
                    <Button title="Edit" small variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/sell/[id]', params: { id: v.id } })} />
                    <Button title="Delete" small variant="danger" onPress={() => onDelete(v)} />
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Perk({ icon, title, body }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <View style={styles.perkIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.perkTitle}>{title}</Text>
        <Text style={styles.perkBody}>{body}</Text>
      </View>
    </View>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.statCard, accent && { borderColor: colors.text }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: VaultStatus }) {
  const map = {
    published: { bg: colors.successSoft, fg: colors.success, label: 'Live' },
    draft: { bg: colors.warningSoft, fg: colors.warning, label: 'Draft' },
    unlisted: { bg: colors.surfaceRaised, fg: colors.muted, label: 'Unlisted' },
  }[status];
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      <Text style={[styles.pillText, { color: map.fg }]}>{map.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2 },
  fine: { color: colors.faint, fontSize: 12, textAlign: 'center' },
  perkIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  perkTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  perkBody: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  warn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  warnText: { flex: 1, color: colors.text, fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: 4 },
  listing: { gap: spacing.sm },
  listingActions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xs },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: '700' },
});
