import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaultRow, VaultTile } from '../../src/components/VaultCard';
import { ErrorBox, Loading, SectionTitle } from '../../src/components/ui';
import { useAsync } from '../../src/hooks/useAsync';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/auth';
import { colors, radius, spacing } from '../../src/theme';
import { CATEGORIES } from '../../src/types';

export default function ExploreScreen() {
  const router = useRouter();
  const { isDemo } = useAuth();
  const [query, setQuery] = useState('');

  const featured = useAsync(() => api.listVaults({ featured: true, limit: 6 }), []);
  const trending = useAsync(() => api.listVaults({ sort: 'popular', limit: 5 }), []);
  const fresh = useAsync(() => api.listVaults({ sort: 'new', limit: 5 }), []);
  const free = useAsync(() => api.listVaults({ freeOnly: true, sort: 'popular', limit: 5 }), []);

  const loading = featured.loading && trending.loading;
  const refreshAll = () => Promise.all([featured.refresh(), trending.refresh(), fresh.refresh(), free.refresh()]);

  const submitSearch = () => {
    const q = query.trim();
    if (!q) return;
    router.push({ pathname: '/browse', params: { q } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refreshAll} tintColor={colors.accent} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Vault Market</Text>
            <Text style={styles.brandSub}>Ready-made Obsidian vaults from people who live in them.</Text>
          </View>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            placeholder="Search vaults, plugins, tags"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        {isDemo ? (
          <View style={styles.demoBanner}>
            <Ionicons name="flask" size={16} color={colors.warning} />
            <Text style={styles.demoText}>Demo mode: sample data, instant purchases. Connect Supabase to go live.</Text>
          </View>
        ) : null}

        {loading ? <Loading /> : null}
        {featured.error ? <ErrorBox message={featured.error} onRetry={featured.refresh} /> : null}

        {featured.data && featured.data.length > 0 ? (
          <>
            <SectionTitle>Featured</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {featured.data.map((v) => (
                <VaultTile key={v.id} vault={v} />
              ))}
            </ScrollView>
          </>
        ) : null}

        <SectionTitle action="See all" onAction={() => router.push('/browse')}>
          Categories
        </SectionTitle>
        <View style={styles.grid}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.slug}
              onPress={() => router.push({ pathname: '/browse', params: { category: c.slug } })}
              style={({ pressed }) => [styles.category, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name={c.icon} size={18} color={colors.muted} />
              <Text style={styles.categoryText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        {trending.data && trending.data.length > 0 ? (
          <>
            <SectionTitle action="More" onAction={() => router.push({ pathname: '/browse', params: { sort: 'popular' } })}>
              Trending
            </SectionTitle>
            <View style={styles.list}>
              {trending.data.map((v) => (
                <VaultRow key={v.id} vault={v} />
              ))}
            </View>
          </>
        ) : null}

        {free.data && free.data.length > 0 ? (
          <>
            <SectionTitle action="More" onAction={() => router.push({ pathname: '/browse', params: { free: '1' } })}>
              Free to start
            </SectionTitle>
            <View style={styles.list}>
              {free.data.map((v) => (
                <VaultRow key={v.id} vault={v} />
              ))}
            </View>
          </>
        ) : null}

        {fresh.data && fresh.data.length > 0 ? (
          <>
            <SectionTitle action="More" onAction={() => router.push({ pathname: '/browse', params: { sort: 'new' } })}>
              New arrivals
            </SectionTitle>
            <View style={styles.list}>
              {fresh.data.map((v) => (
                <VaultRow key={v.id} vault={v} />
              ))}
            </View>
          </>
        ) : null}

        <Pressable onPress={() => router.push('/sell')} style={styles.sellCta}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sellTitle}>Built a vault you love?</Text>
            <Text style={styles.sellText}>Sell it here. You keep 85% of every sale, paid out by Stripe.</Text>
          </View>
          <Ionicons name="arrow-forward-circle" size={32} color={colors.accent} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  brandSub: { fontSize: 14, color: colors.muted, marginTop: 2 },
  search: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16 },
  demoBanner: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  demoText: { flex: 1, color: colors.text, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  category: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  categoryText: { color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  list: { gap: spacing.sm },
  sellCta: {
    marginTop: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sellTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  sellText: { color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
});
