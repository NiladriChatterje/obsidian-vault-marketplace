import { Image, type ImageStyle } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatCount } from '../lib/format';
import { colors, radius, spacing } from '../theme';
import type { Vault } from '../types';
import { PriceTag, Stars } from './ui';

/** Cover image when the seller uploaded one, otherwise a typographic monogram. */
export function VaultCover({ vault, style, monogramSize = 40 }: { vault: Vault; style?: StyleProp<ViewStyle>; monogramSize?: number }) {
  if (vault.coverUrl) {
    return (
      <Image
        source={{ uri: vault.coverUrl }}
        style={[styles.cover, style as StyleProp<ImageStyle>]}
        contentFit="cover"
        transition={150}
      />
    );
  }
  const initials = vault.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[styles.cover, styles.monogram, style]}>
      <Text style={[styles.monogramText, { fontSize: monogramSize }]}>{initials}</Text>
    </View>
  );
}

/** Large card for carousels and featured rows. */
export function VaultTile({ vault, width = 260 }: { vault: Vault; width?: number }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/vault/[id]', params: { id: vault.id } })}
      style={({ pressed }) => [styles.tile, { width }, pressed && { opacity: 0.7 }]}
    >
      <VaultCover vault={vault} style={{ height: 140 }} />
      <View style={styles.tileBody}>
        <View style={styles.tileTop}>
          <Text style={styles.tileTitle} numberOfLines={1}>
            {vault.title}
          </Text>
          <PriceTag cents={vault.priceCents} currency={vault.currency} />
        </View>
        <Text style={styles.tileTagline} numberOfLines={2}>
          {vault.tagline}
        </Text>
        <View style={styles.tileMeta}>
          <Stars rating={vault.ratingAvg} count={vault.ratingCount} size={12} />
          <Text style={styles.metaText}>{formatCount(vault.downloads)} downloads</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Compact row for lists. */
export function VaultRow({ vault, onPress, right }: { vault: Vault; onPress?: () => void; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/vault/[id]', params: { id: vault.id } }))}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <VaultCover vault={vault} style={styles.rowCover} monogramSize={20} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {vault.title}
        </Text>
        <Text style={styles.rowTagline} numberOfLines={2}>
          {vault.tagline}
        </Text>
        <View style={styles.tileMeta}>
          <Stars rating={vault.ratingAvg} count={vault.ratingCount} size={11} />
          {vault.seller ? (
            <Text style={styles.metaText} numberOfLines={1}>
              {vault.seller.displayName}
            </Text>
          ) : null}
        </View>
      </View>
      {right ?? <PriceTag cents={vault.priceCents} currency={vault.currency} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  monogram: { backgroundColor: colors.surfaceRaised },
  monogramText: { color: colors.text, fontWeight: '700', letterSpacing: -1 },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileBody: { padding: spacing.md, gap: 6 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tileTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  tileTagline: { fontSize: 13, color: colors.muted, lineHeight: 18, minHeight: 36 },
  tileMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  metaText: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowCover: { width: 56, height: 56, borderRadius: radius.md },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowTagline: { fontSize: 12, color: colors.muted, lineHeight: 16 },
});
