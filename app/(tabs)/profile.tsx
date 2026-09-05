import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, EmptyState, Input, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/auth';
import { colors, radius, spacing } from '../../src/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, signOut, refreshProfile, isDemo, loading } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.id, profile?.displayName, profile?.bio]);

  const dirty = !!profile && (displayName !== profile.displayName || bio !== (profile.bio ?? ''));

  const onSave = async () => {
    setSaving(true);
    try {
      await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim() });
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Profile</Text>

        {!user && !loading ? (
          <EmptyState
            icon="person-circle-outline"
            title="You are not signed in"
            message="Sign in to buy vaults, keep a library, leave reviews and sell your own."
            action={<Button title="Sign in or create account" onPress={() => router.push('/auth')} />}
          />
        ) : null}

        {user && profile ? (
          <>
            <View style={styles.header}>
              <Avatar name={profile.displayName} url={profile.avatarUrl} size={72} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{profile.displayName}</Text>
                <Text style={styles.handle}>@{profile.username}</Text>
                <Text style={styles.email}>{user.email}</Text>
              </View>
              {profile.isSeller ? (
                <View style={styles.badge}>
                  <Ionicons name="storefront" size={12} color={colors.accent} />
                  <Text style={styles.badgeText}>Seller</Text>
                </View>
              ) : null}
            </View>

            <SectionTitle>Public profile</SectionTitle>
            <Card style={{ gap: spacing.md }}>
              <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={40} />
              <Input label="Bio" value={bio} onChangeText={setBio} multiline style={{ minHeight: 80 }} placeholder="What do you build in Obsidian?" maxLength={240} />
              <Button title="Save" small onPress={onSave} loading={saving} disabled={!dirty} />
            </Card>

            <SectionTitle>Account</SectionTitle>
            <Card style={{ gap: spacing.md }}>
              {!profile.isSeller ? (
                <Button title="Start selling" variant="secondary" icon="storefront-outline" onPress={() => router.push('/sell')} />
              ) : null}
              <Button
                title="Sign out"
                variant="danger"
                icon="log-out-outline"
                onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])}
              />
            </Card>
          </>
        ) : null}

        <SectionTitle>About</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.about}>
            Vault Market is an independent marketplace for Obsidian vaults. It is not affiliated with Obsidian or Dynalist Inc.
          </Text>
          <Text style={styles.about}>Sellers keep the rights to their work. Buyers get a personal, non-transferable license.</Text>
          {isDemo ? <Text style={[styles.about, { color: colors.warning }]}>Running in demo mode with sample data.</Text> : null}
          <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  handle: { color: colors.muted, fontSize: 14 },
  email: { color: colors.faint, fontSize: 12, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  badgeText: { color: colors.accent, fontWeight: '700', fontSize: 12 },
  about: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  version: { color: colors.faint, fontSize: 12, marginTop: spacing.sm },
});
