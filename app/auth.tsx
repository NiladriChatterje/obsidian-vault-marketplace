import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input } from '../src/components/ui';
import { useAuth } from '../src/store/auth';
import { colors, radius, spacing } from '../src/theme';

export default function AuthScreen() {
  const router = useRouter();
  const { signIn, signUp, isDemo } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const valid =
    /\S+@\S+\.\S+/.test(email) && (isDemo || password.length >= 8) && (mode === 'in' || /^[a-z0-9_.]{3,24}$/i.test(username));

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password);
        router.back();
      } else {
        const { needsEmailConfirm } = await signUp(email.trim(), password, username.trim().toLowerCase());
        if (needsEmailConfirm) {
          Alert.alert('Check your inbox', 'We sent a confirmation link. Tap it, then sign in.', [{ text: 'OK', onPress: () => setMode('in') }]);
        } else {
          router.back();
        }
      }
    } catch (e) {
      Alert.alert(mode === 'in' ? 'Sign in failed' : 'Sign up failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.close} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>{mode === 'in' ? 'Welcome back' : 'Create your account'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'in' ? 'Sign in to access your library and listings.' : 'Buy, review and sell Obsidian vaults.'}
          </Text>

          <View style={styles.segment}>
            <Pressable onPress={() => setMode('in')} style={[styles.segmentItem, mode === 'in' && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === 'in' && { color: colors.onPrimary }]}>Sign in</Text>
            </Pressable>
            <Pressable onPress={() => setMode('up')} style={[styles.segmentItem, mode === 'up' && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === 'up' && { color: colors.onPrimary }]}>Sign up</Text>
            </Pressable>
          </View>

          <View style={{ gap: spacing.md }}>
            {mode === 'up' ? (
              <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="nova.notes" hint="3 to 24 characters. Letters, numbers, dots and underscores." />
            ) : null}
            <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'in' ? 'password' : 'new-password'}
              placeholder={isDemo ? 'Anything works in demo mode' : 'At least 8 characters'}
            />
            <Button title={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} disabled={!valid} />
          </View>

          {isDemo ? (
            <Text style={styles.demo}>Demo mode: any email signs you in locally. Nothing is sent anywhere.</Text>
          ) : (
            <Text style={styles.demo}>By continuing you agree to the Terms and the Seller Agreement.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40 },
  close: { alignSelf: 'flex-end', width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: spacing.md },
  subtitle: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.xl },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border },
  segmentItem: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.muted, fontWeight: '700' },
  demo: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
});
