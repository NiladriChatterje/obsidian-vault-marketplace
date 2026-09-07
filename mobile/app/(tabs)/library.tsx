import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaultRow } from '../../src/components/VaultCard';
import { Button, EmptyState, ErrorBox, Loading } from '../../src/components/ui';
import { useAsync } from '../../src/hooks/useAsync';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/auth';
import { colors, spacing } from '../../src/theme';

export default function LibraryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const library = useAsync(() => (user ? api.getLibrary() : Promise.resolve([])), [user?.id]);
  const [downloading, setDownloading] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) library.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id])
  );

  const download = async (vaultId: string) => {
    setDownloading(vaultId);
    try {
      const url = await api.getDownloadUrl(vaultId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Library</Text>
        <Text style={styles.subtitle}>Everything you own, ready to download again any time.</Text>
      </View>
      {!user ? (
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to see your library"
          message="Purchases are tied to your account so you can re-download on any device."
          action={<Button title="Sign in" onPress={() => router.push('/auth')} />}
        />
      ) : (
        <>
          {library.error ? <ErrorBox message={library.error} onRetry={library.refresh} /> : null}
          <FlatList
            data={library.data ?? []}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item }) =>
              item.vault ? (
                <VaultRow
                  vault={item.vault}
                  right={
                    <Button
                      title="Get"
                      small
                      icon="download-outline"
                      variant="secondary"
                      loading={downloading === item.vaultId}
                      onPress={() => download(item.vaultId)}
                    />
                  }
                />
              ) : null
            }
            ListEmptyComponent={
              library.loading ? (
                <Loading />
              ) : (
                <EmptyState
                  icon="albums-outline"
                  title="Nothing here yet"
                  message="Free vaults and purchases show up here. Start with something free to see how it works."
                  action={<Button title="Browse free vaults" variant="secondary" onPress={() => router.push({ pathname: '/browse', params: { free: '1' } })} />}
                />
              )
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2 },
  list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 48 },
});
