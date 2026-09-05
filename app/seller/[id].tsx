import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { VaultRow } from '../../src/components/VaultCard';
import { Avatar, EmptyState, ErrorBox, Loading, SectionTitle } from '../../src/components/ui';
import { useAsync } from '../../src/hooks/useAsync';
import { api } from '../../src/lib/api';
import { formatCount } from '../../src/lib/format';
import { colors, spacing } from '../../src/theme';

export default function SellerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useAsync(() => api.getProfile(id), [id]);
  const vaults = useAsync(() => api.getSellerVaults(id), [id]);

  const p = profile.data;
  const totalDownloads = vaults.data?.reduce((sum, v) => sum + v.downloads, 0) ?? 0;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: p?.displayName ?? 'Seller' }} />
      {profile.loading && !p ? <Loading /> : null}
      {profile.error ? <ErrorBox message={profile.error} onRetry={profile.refresh} /> : null}
      {p ? (
        <View style={styles.header}>
          <Avatar name={p.displayName} url={p.avatarUrl} size={72} />
          <Text style={styles.name}>{p.displayName}</Text>
          <Text style={styles.handle}>@{p.username}</Text>
          {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
          <View style={styles.stats}>
            <Text style={styles.stat}>
              <Text style={styles.statValue}>{vaults.data?.length ?? 0}</Text> vaults
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.statValue}>{formatCount(totalDownloads)}</Text> downloads
            </Text>
          </View>
        </View>
      ) : null}

      <SectionTitle>Vaults</SectionTitle>
      {vaults.loading ? <Loading /> : null}
      {vaults.data && vaults.data.length === 0 ? (
        <EmptyState icon="albums-outline" title="No published vaults" message="This seller has not published anything yet." />
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {vaults.data?.map((v) => (
          <VaultRow key={v.id} vault={v} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  header: { alignItems: 'center', gap: 4, paddingVertical: spacing.lg },
  name: { fontSize: 22, fontWeight: '900', color: colors.text, marginTop: spacing.sm },
  handle: { color: colors.muted, fontSize: 14 },
  bio: { color: colors.text, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  stat: { color: colors.muted, fontSize: 14 },
  statValue: { color: colors.text, fontWeight: '800' },
});
