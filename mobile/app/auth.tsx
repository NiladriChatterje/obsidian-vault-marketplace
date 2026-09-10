import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input } from '../src/components/ui';
import { MIN_PASSWORD_LENGTH } from '../src/lib/config';
import { useAuth } from '../src/store/auth';
import { colors, radius, spacing } from '../src/theme';

type Mode = 'in' | 'up' | 'forgot';

export default function AuthScreen() {
  const router = useRouter();
  const { signIn, signUp, isUsernameAvailable, sendPasswordReset, resendConfirmation, isDemo } = useAuth();
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const emailOk = /\S+@\S+\.\S+/.test(email);
  const valid =
    emailOk &&
    (mode === 'forgot' || isDemo || password.length >= MIN_PASSWORD_LENGTH) &&
    (mode !== 'up' || /^[a-z0-9_.]{3,24}$/i.test(username));

  /** The confirmation mail is the only way past an unconfirmed address, so offer to send it again. */
  const offerResend = (address: string) => {
    Alert.alert('Confirm your email first', 'Open the link we sent you, then sign in.', [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send it again',
        onPress: async () => {
          try {
            await resendConfirmation(address);
            Alert.alert('Sent', 'Check your inbox again in a minute.');
          } catch (e) {
            Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  };

  const submit = async () => {
    const address = email.trim().toLowerCase();
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(address);
        // Same wording either way: it must not reveal whether the address has an account.
        Alert.alert('Check your inbox', `If an account exists for ${address}, a reset link is on its way. It opens the website.`, [
          { text: 'OK', onPress: () => setMode('in') },
        ]);
      } else if (mode === 'in') {
        await signIn(address, password);
        router.back();
      } else {
        const name = username.trim().toLowerCase();
        if (!isDemo && !(await isUsernameAvailable(name))) throw new Error('That username is taken. Pick another.');
        const { needsEmailConfirm } = await signUp(address, password, name);
        if (needsEmailConfirm) {
          Alert.alert('Check your inbox', 'We sent a confirmation link. Tap it, then sign in.', [{ text: 'OK', onPress: () => setMode('in') }]);
        } else {
          router.back();
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Please try again.';
      if (/confirm your email/i.test(message)) offerResend(address);
      else Alert.alert(mode === 'in' ? 'Sign in failed' : mode === 'up' ? 'Sign up failed' : 'Could not send the link', message);
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
          <Text style={styles.title}>
            {mode === 'in' ? 'Welcome back' : mode === 'up' ? 'Create your account' : 'Reset your password'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'in'
              ? 'Sign in to access your library and listings.'
              : mode === 'up'
                ? 'Buy, review and sell Obsidian vaults.'
                : 'We will email you a link to set a new password.'}
          </Text>

          <View style={styles.segment}>
            <Pressable onPress={() => setMode('in')} style={[styles.segmentItem, mode !== 'up' && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode !== 'up' && { color: colors.onPrimary }]}>Sign in</Text>
            </Pressable>
            <Pressable onPress={() => setMode('up')} style={[styles.segmentItem, mode === 'up' && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === 'up' && { color: colors.onPrimary }]}>Sign up</Text>
            </Pressable>
          </View>

          <View style={{ gap: spacing.md }}>
            {mode === 'up' ? (
              <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="nova.notes" hint="3 to 24 characters. Letters, numbers, dots and underscores. This is your public seller name." />
            ) : null}
            <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
            {mode === 'forgot' ? null : (
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'in' ? 'password' : 'new-password'}
                placeholder={isDemo ? 'Anything works in demo mode' : `At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            )}
            <Button
              title={mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Email me a reset link'}
              onPress={submit}
              loading={busy}
              disabled={!valid}
            />
            {mode === 'in' ? (
              <Button title="Forgot your password?" variant="ghost" onPress={() => setMode('forgot')} />
            ) : null}
            {mode === 'forgot' ? <Button title="Back to sign in" variant="ghost" onPress={() => setMode('in')} /> : null}
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
