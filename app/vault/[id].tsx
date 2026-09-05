import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaultCover } from '../../src/components/VaultCard';
import { Avatar, Button, Card, Chip, ErrorBox, Input, Loading, PriceTag, SectionTitle, Stars } from '../../src/components/ui';
import { useAsync } from '../../src/hooks/useAsync';
import { api } from '../../src/lib/api';
import { APP_SCHEME } from '../../src/lib/config';
import { formatBytes, formatCount, timeAgo } from '../../src/lib/format';
import { useAuth } from '../../src/store/auth';
import { colors, radius, spacing } from '../../src/theme';
import { categoryLabel } from '../../src/types';

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, isDemo } = useAuth();

  const vault = useAsync(() => api.getVault(id), [id]);
  const reviews = useAsync(() => api.getReviews(id), [id]);
  const access = useAsync(() => (user ? api.hasAccess(id) : Promise.resolve(false)), [id, user?.id]);

  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const v = vault.data;
  const owned = !!access.data;
  const isMine = !!user && v?.sellerId === user.id;

  const requireAuth = (): boolean => {
    if (user) return true;
    router.push('/auth');
    return false;
  };

  const onGet = async () => {
    if (!v || !requireAuth()) return;
    setBusy(true);
    try {
      if (v.priceCents === 0) {
        await api.claimFreeVault(v.id);
      } else {
        const { url } = await api.createCheckout(v.id);
        if (!isDemo) {
          const result = await WebBrowser.openAuthSessionAsync(url, `${APP_SCHEME}://checkout-result`);
          if (result.type !== 'success') {
            // User closed the sheet; the webhook may still land, so refresh anyway.
          }
          // Webhooks can lag a second or two behind the redirect.
          for (let i = 0; i < 5; i++) {
            if (await api.hasAccess(v.id)) break;
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await Promise.all([access.refresh(), vault.refresh()]);
    } catch (e) {
      Alert.alert('Could not complete', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const url = await api.getDownloadUrl(v.id);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitReview = async () => {
    if (!v || !reviewBody.trim()) return;
    setSubmittingReview(true);
    try {
      await api.addReview(v.id, rating, reviewBody.trim());
      setReviewBody('');
      await Promise.all([reviews.refresh(), vault.refresh()]);
    } catch (e) {
      Alert.alert('Could not post review', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmittingReview(false);
    }
  };

  if (vault.loading && !v) return <Loading />;
  if (vault.error || !v) {
    return (
      <View style={{ padding: spacing.lg }}>
        <ErrorBox message={vault.error ?? 'Vault not found'} onRetry={vault.refresh} />
      </View>
    );
  }

  const myReview = user ? reviews.data?.find((r) => r.userId === user.id) : undefined;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: v.title }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <VaultCover vault={v} style={styles.hero} monogramSize={56} />

        <View style={styles.titleRow}>
          <Text style={styles.title}>{v.title}</Text>
          <PriceTag cents={v.priceCents} currency={v.currency} large />
        </View>
        <Text style={styles.tagline}>{v.tagline}</Text>

        <View style={styles.metaRow}>
          <Stars rating={v.ratingAvg} count={v.ratingCount} />
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{formatCount(v.downloads)} downloads</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{categoryLabel(v.category)}</Text>
        </View>

        {v.seller ? (
          <Pressable
            onPress={() => router.push({ pathname: '/seller/[id]', params: { id: v.sellerId } })}
            style={styles.sellerRow}
          >
            <Avatar name={v.seller.displayName} url={v.seller.avatarUrl} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sellerName}>{v.seller.displayName}</Text>
              <Text style={styles.sellerHandle}>@{v.seller.username}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : null}

        <View style={styles.statsRow}>
          <Stat label="Notes" value={String(v.noteCount)} />
          <Stat label="Size" value={formatBytes(v.sizeBytes)} />
          <Stat label="Version" value={`v${v.version}`} />
          <Stat label="Updated" value={timeAgo(v.updatedAt)} />
        </View>

        <SectionTitle>About this vault</SectionTitle>
        <Text style={styles.description}>{v.description}</Text>

        {v.plugins.length > 0 ? (
          <>
            <SectionTitle>Plugins used</SectionTitle>
            <View style={styles.chips}>
              {v.plugins.map((p) => (
                <Chip key={p} label={p} icon="extension-puzzle-outline" />
              ))}
            </View>
          </>
        ) : null}

        {v.tags.length > 0 ? (
          <View style={[styles.chips, { marginTop: spacing.lg }]}>
            {v.tags.map((t) => (
              <Pressable key={t} onPress={() => router.push({ pathname: '/browse', params: { q: t } })}>
                <Text style={styles.tag}>#{t}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <SectionTitle>Reviews</SectionTitle>
        {owned && !isMine ? (
          <Card style={{ gap: spacing.md, marginBottom: spacing.md }}>
            <Text style={styles.reviewPrompt}>{myReview ? 'Update your review' : 'How is it working for you?'}</Text>
            <View style={styles.ratingPicker}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                  <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={28} color={colors.star} />
                </Pressable>
              ))}
            </View>
            <Input
              value={reviewBody}
              onChangeText={setReviewBody}
              placeholder="What did it change about how you take notes?"
              multiline
              style={{ minHeight: 80 }}
            />
            <Button title="Post review" small onPress={onSubmitReview} loading={submittingReview} disabled={!reviewBody.trim()} />
          </Card>
        ) : null}
        {reviews.loading ? <Loading /> : null}
        {reviews.data && reviews.data.length === 0 ? (
          <Text style={styles.noReviews}>No reviews yet. Be the first once you have tried it.</Text>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          {reviews.data?.map((r) => (
            <Card key={r.id} style={{ gap: 6 }}>
              <View style={styles.reviewHead}>
                <Avatar name={r.author?.displayName ?? 'U'} url={r.author?.avatarUrl} size={28} />
                <Text style={styles.reviewAuthor}>{r.author?.displayName ?? 'Buyer'}</Text>
                <Text style={styles.reviewTime}>{timeAgo(r.createdAt)}</Text>
              </View>
              <Stars rating={r.rating} size={13} />
              <Text style={styles.reviewBody}>{r.body}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {isMine ? (
          <Button
            title="Edit listing"
            variant="secondary"
            icon="create-outline"
            onPress={() => router.push({ pathname: '/sell/[id]', params: { id: v.id } })}
          />
        ) : owned ? (
          <Button title="Download vault (.zip)" icon="download-outline" variant="success" onPress={onDownload} loading={busy} />
        ) : (
          <Button
            title={v.priceCents === 0 ? 'Get for free' : `Buy for ${new Intl.NumberFormat(undefined, { style: 'currency', currency: v.currency }).format(v.priceCents / 100)}`}
            icon={v.priceCents === 0 ? 'gift-outline' : 'cart-outline'}
            onPress={onGet}
            loading={busy || access.loading}
          />
        )}
        {!owned && !isMine && v.priceCents > 0 ? (
          <Text style={styles.barNote}>Secure checkout by Stripe. Instant download after payment.</Text>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 140 },
  hero: { height: 200, borderRadius: radius.xl },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.lg },
  title: { flex: 1, fontSize: 26, fontWeight: '700', color: colors.text, lineHeight: 30 },
  tagline: { fontSize: 15, color: colors.muted, lineHeight: 22, marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: spacing.md },
  meta: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  dot: { color: colors.faint, marginHorizontal: 2 },
  sellerRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sellerName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sellerHandle: { color: colors.muted, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statValue: { color: colors.text, fontWeight: '700', fontSize: 14 },
  statLabel: { color: colors.faint, fontSize: 11, marginTop: 2 },
  description: { color: colors.text, fontSize: 15, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  reviewPrompt: { color: colors.text, fontWeight: '700', fontSize: 15 },
  ratingPicker: { flexDirection: 'row', gap: spacing.sm },
  noReviews: { color: colors.muted, fontSize: 14 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewAuthor: { flex: 1, color: colors.text, fontWeight: '700' },
  reviewTime: { color: colors.faint, fontSize: 12 },
  reviewBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  barNote: { textAlign: 'center', color: colors.faint, fontSize: 12 },
});
