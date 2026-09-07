import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, Input } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { PLATFORM_FEE_PERCENT } from '../../../src/lib/config';
import { EMPTY_PAYOUT_DETAILS, PAYOUT_FIELDS, normalizePayoutDetails, validatePayoutDetails } from '../../../src/lib/payouts';
import { useAuth } from '../../../src/store/auth';
import { colors, spacing } from '../../../src/theme';
import type { PayoutDetails } from '../../../src/types';

/** One-time KYC + bank form that creates the seller's Razorpay Route linked account. */
export default function PayoutsScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile, isDemo } = useAuth();
  const [details, setDetails] = useState<PayoutDetails>({ ...EMPTY_PAYOUT_DETAILS, legalName: profile?.displayName ?? '' });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof PayoutDetails) => (value: string) => setDetails((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!user) return router.push('/auth');
    const problem = validatePayoutDetails(details);
    if (problem) return Alert.alert('Check the form', problem);
    setSaving(true);
    try {
      const { status } = await api.setupPayouts(normalizePayoutDetails(details));
      await refreshProfile();
      Alert.alert(
        status === 'activated' ? 'Payouts active' : 'Details submitted',
        status === 'activated'
          ? 'You can publish paid vaults now.'
          : 'Razorpay is verifying your details, usually within a day or two. You can list free vaults meanwhile.'
      );
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>
          Buyers pay Vault Market through Razorpay. After each sale your share ({100 - PLATFORM_FEE_PERCENT}%) is transferred to the bank account below via Razorpay Route.
          {isDemo ? ' Demo mode: nothing is sent anywhere.' : ''}
        </Text>
        <Card style={{ gap: spacing.md }}>
          {PAYOUT_FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              value={details[f.key]}
              onChangeText={set(f.key)}
              placeholder={f.placeholder}
              hint={f.hint}
              autoCapitalize={f.key === 'pan' || f.key === 'ifsc' ? 'characters' : 'words'}
              keyboardType={f.keyboard === 'numeric' ? 'number-pad' : f.keyboard === 'phone' ? 'phone-pad' : 'default'}
            />
          ))}
        </Card>
        <Button title={profile?.razorpayAccountId ? 'Update bank details' : 'Submit for verification'} onPress={submit} loading={saving} style={{ marginTop: spacing.lg }} />
        <Text style={styles.fine}>Your details go straight to Razorpay and are used only to verify you and settle payouts.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.md },
  help: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  fine: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
