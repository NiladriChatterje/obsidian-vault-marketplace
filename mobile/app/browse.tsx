import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { VaultRow } from '../../src/components/VaultCard';
import { Chip, EmptyState, ErrorBox, Loading } from '../../src/components/ui';
import { useAsync } from '../../src/hooks/useAsync';
import { api } from '../../src/lib/api';
import { colors, radius, spacing } from '../../src/theme';
import { CATEGORIES, categoryLabel, type CategorySlug, type SortMode } from '../../src/types';

const SORTS: Array<{ key: SortMode; label: string }> = [
  { key: 'popular', label: 'Popular' },
  { key: 'top', label: 'Top rated' },
  { key: 'new', label: 'Newest' },
];

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ q?: string; category?: string; sort?: string; free?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const [submitted, setSubmitted] = useState(params.q ?? '');
  const [category, setCategory] = useState<CategorySlug | undefined>(params.category as CategorySlug | undefined);
  const [sort, setSort] = useState<SortMode>((params.sort as SortMode) ?? 'popular');
  const [freeOnly, setFreeOnly] = useState(params.free === '1');

  useEffect(() => {
    const t = setTimeout(() => setSubmitted(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const results = useAsync(
    () => api.listVaults({ search: submitted || undefined, category, sort, freeOnly }),
    [submitted, category, sort, freeOnly]
  );

  const title = category ? categoryLabel(category) : submitted ? `"${submitted}"` : 'Browse';

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title }} />
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search vaults, plugins, tags"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          returnKeyType="search"
          autoFocus={!!params.q}
        />
        {query ? (
          <Ionicons name="close-circle" size={18} color={colors.muted} onPress={() => setQuery('')} />
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SORTS.map((s) => (
          <Chip key={s.key} label={s.label} selected={sort === s.key} onPress={() => setSort(s.key)} />
        ))}
        <Chip label="Free" icon="gift-outline" selected={freeOnly} onPress={() => setFreeOnly((v) => !v)} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
        {CATEGORIES.map((c) => (
          <Chip
            key={c.slug}
            label={c.label}
            icon={c.icon}
            selected={category === c.slug}
            onPress={() => setCategory(category === c.slug ? undefined : c.slug)}
          />
        ))}
      </ScrollView>

      {results.error ? <ErrorBox message={results.error} onRetry={results.refresh} /> : null}
      <FlatList
        data={results.data ?? []}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => <VaultRow vault={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          results.loading ? (
            <Loading />
          ) : (
            <EmptyState icon="search" title="No vaults found" message="Try a different search, category or sort order." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  search: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
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
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm },
  list: { padding: spacing.lg, paddingBottom: 48 },
});
