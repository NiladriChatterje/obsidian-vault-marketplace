import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../src/components/ui';
import { colors, spacing } from '../src/theme';

/** Deep-link target for Stripe's success_url / cancel_url. */
export default function CheckoutResultScreen() {
  const router = useRouter();
  const { status, vault } = useLocalSearchParams<{ status?: string; vault?: string }>();
  const ok = status === 'success';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={72} color={ok ? colors.success : colors.muted} />
        <Text style={styles.title}>{ok ? 'Payment received' : 'Checkout cancelled'}</Text>
        <Text style={styles.text}>
          {ok
            ? 'Your vault is being added to your library. This usually takes a second or two.'
            : 'No charge was made. You can come back to the vault any time.'}
        </Text>
        <View style={{ gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.xl }}>
          {vault ? (
            <Button title={ok ? 'Open vault' : 'Back to vault'} onPress={() => router.replace({ pathname: '/vault/[id]', params: { id: vault } })} />
          ) : null}
          <Button title="Go to library" variant="secondary" onPress={() => router.replace('/library')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  text: { color: colors.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
