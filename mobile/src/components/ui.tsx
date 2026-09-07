import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, small, style }: ButtonProps) {
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: 'transparent', fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.muted, border: 'transparent' },
    danger: { bg: 'transparent', fg: colors.muted, border: colors.border },
    success: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={palette.fg} /> : null}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: palette.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function Chip({ label, selected, onPress, icon }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {icon ? <Ionicons name={icon} size={13} color={selected ? colors.onPrimary : colors.muted} /> : null}
      <Text style={[styles.chipText, selected && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function Input({ label, hint, error, style, ...rest }: InputProps) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        style={[styles.input, rest.multiline && styles.inputMultiline, error && { borderColor: colors.danger }, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Stars({ rating, size = 14, count }: { rating: number; size?: number; count?: number }) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={rounded >= i ? 'star' : rounded >= i - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color={colors.star}
        />
      ))}
      {count !== undefined ? (
        <Text style={[styles.starText, { fontSize: size - 1 }]}>
          {rating > 0 ? rating.toFixed(1) : 'New'}
          {count > 0 ? ` (${count})` : ''}
        </Text>
      ) : null}
    </View>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function PriceTag({ cents, currency, large }: { cents: number; currency: string; large?: boolean }) {
  const free = cents === 0;
  const text = free ? 'Free' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  return <Text style={[styles.priceText, free && { color: colors.muted }, large && { fontSize: 20 }]}>{text}</Text>;
}

interface EmptyProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyProps) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action ? <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text style={styles.errorBoxText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  buttonSmall: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sectionAction: { fontSize: 14, fontWeight: '600', color: colors.accent },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '500', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  hint: { fontSize: 12, color: colors.faint },
  error: { fontSize: 12, color: colors.danger },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  starText: { color: colors.muted, marginLeft: 4, fontWeight: '600' },
  avatar: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontWeight: '700' },
  priceText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl * 1.5, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.xs, textAlign: 'center' },
  emptyMessage: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: spacing.md,
  },
  errorBoxText: { flex: 1, color: colors.text, fontSize: 14 },
});
