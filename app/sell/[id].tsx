import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, Chip, Input, Loading, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { MAX_VAULT_ZIP_BYTES, MIN_PRICE_CENTS, PLATFORM_FEE_PERCENT } from '../../src/lib/config';
import { formatBytes, formatPrice, parsePriceToCents, parseTags } from '../../src/lib/format';
import { useAuth } from '../../src/store/auth';
import { colors, radius, spacing } from '../../src/theme';
import { CATEGORIES, type CategorySlug, type Vault, type VaultInput } from '../../src/types';

export default function ListingFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [existing, setExisting] = useState<Vault | null>(null);

  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CategorySlug>('pkm');
  const [isPaid, setIsPaid] = useState(true);
  const [priceText, setPriceText] = useState('499');
  const [tagsText, setTagsText] = useState('');
  const [pluginsText, setPluginsText] = useState('');
  const [noteCount, setNoteCount] = useState('');
  const [version, setVersion] = useState('1.0');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = useState(0);

  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);

  useEffect(() => {
    if (isNew) return;
    api
      .getVault(id)
      .then((v) => {
        if (!v) throw new Error('Listing not found');
        setExisting(v);
        setTitle(v.title);
        setTagline(v.tagline);
        setDescription(v.description);
        setCategory(v.category);
        setIsPaid(v.priceCents > 0);
        setPriceText(v.priceCents > 0 ? (v.priceCents / 100).toFixed(2) : '499');
        setTagsText(v.tags.join(', '));
        setPluginsText(v.plugins.join(', '));
        setNoteCount(v.noteCount ? String(v.noteCount) : '');
        setVersion(v.version);
        setCoverUrl(v.coverUrl ?? null);
        setFilePath(v.filePath ?? null);
        setFileName(v.filePath ? v.filePath.split('/').pop() ?? 'vault.zip' : null);
        setSizeBytes(v.sizeBytes);
      })
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Could not load listing'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const priceCents = isPaid ? parsePriceToCents(priceText) : 0;
  const priceError =
    isPaid && (priceCents === null || priceCents < MIN_PRICE_CENTS) ? `Minimum price is ${formatPrice(MIN_PRICE_CENTS)}` : null;
  const youKeep = priceCents ? Math.round(priceCents * (1 - PLATFORM_FEE_PERCENT / 100)) : 0;

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to pick a cover image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [16, 9] });
    if (result.canceled || !result.assets[0]) return;
    setUploadingCover(true);
    try {
      setCoverUrl(await api.uploadCover(result.assets[0].uri));
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setUploadingCover(false);
    }
  };

  const pickZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.name.toLowerCase().endsWith('.zip')) {
      Alert.alert('Zip files only', 'Export your vault folder as a .zip archive first.');
      return;
    }
    if ((asset.size ?? 0) > MAX_VAULT_ZIP_BYTES) {
      Alert.alert('File too large', `Vault archives must be under ${formatBytes(MAX_VAULT_ZIP_BYTES)}.`);
      return;
    }
    setUploadingFile(true);
    try {
      const uploaded = await api.uploadVaultFile(asset.uri, asset.name);
      setFilePath(uploaded.path);
      setFileName(asset.name);
      setSizeBytes(uploaded.sizeBytes || asset.size || 0);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setUploadingFile(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!user) {
      router.push('/auth');
      return;
    }
    if (title.trim().length < 3) return Alert.alert('Title required', 'Give the vault a clear name.');
    if (tagline.trim().length < 10) return Alert.alert('Tagline required', 'One sentence that says who it is for.');
    if (description.trim().length < 40) return Alert.alert('Description too short', 'Tell buyers what is inside. At least a couple of sentences.');
    if (priceError || priceCents === null) return Alert.alert('Check the price', priceError ?? 'Enter a valid price.');
    if (publish && !filePath) return Alert.alert('Upload the vault', 'Attach the .zip before publishing. You can still save a draft.');

    setSaving(publish ? 'publish' : 'draft');
    try {
      const input: VaultInput = {
        title: title.trim(),
        tagline: tagline.trim(),
        description: description.trim(),
        category,
        tags: parseTags(tagsText),
        priceCents,
        plugins: parseTags(pluginsText).map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())),
        noteCount: Number(noteCount) || 0,
        version: version.trim() || '1.0',
        coverUrl,
        filePath,
        sizeBytes,
        status: publish ? 'published' : existing?.status === 'published' ? 'published' : 'draft',
      };
      await api.saveVault(input, existing?.id);
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: isNew ? 'New listing' : 'Edit listing' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle>Vault file</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          {filePath ? (
            <View style={styles.fileRow}>
              <Ionicons name="document-attach-outline" size={22} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {fileName}
                </Text>
                <Text style={styles.fileMeta}>{sizeBytes ? formatBytes(sizeBytes) : 'Uploaded'}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.help}>
              Zip your vault folder (including the .obsidian folder if your setup depends on it). Remove any personal notes first.
            </Text>
          )}
          <Button title={filePath ? 'Replace .zip' : 'Upload .zip'} variant="secondary" icon="cloud-upload-outline" onPress={pickZip} loading={uploadingFile} />
        </Card>

        <SectionTitle>Basics</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          <Input label="Title" value={title} onChangeText={setTitle} placeholder="Second Brain OS" maxLength={60} />
          <Input label="Tagline" value={tagline} onChangeText={setTagline} placeholder="A PARA + Zettelkasten system with dashboards that run themselves" maxLength={120} />
          <Input
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What is inside, who it is for, how to get started..."
            multiline
          />
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chips}>
              {CATEGORIES.map((c) => (
                <Chip key={c.slug} label={c.label} icon={c.icon} selected={category === c.slug} onPress={() => setCategory(c.slug)} />
              ))}
            </View>
          </View>
        </Card>

        <SectionTitle>Pricing</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Paid vault</Text>
              <Text style={styles.help}>Free vaults are great for building an audience.</Text>
            </View>
            <Switch value={isPaid} onValueChange={setIsPaid} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
          </View>
          {isPaid ? (
            <>
              <Input label="Price (INR)" value={priceText} onChangeText={setPriceText} keyboardType="decimal-pad" placeholder="499" error={priceError} />
              {priceCents && !priceError ? (
                <View style={styles.payout}>
                  <Text style={styles.payoutText}>
                    You receive <Text style={styles.payoutStrong}>{formatPrice(youKeep)}</Text> per sale after the {PLATFORM_FEE_PERCENT}% platform fee. Razorpay processing fees apply.
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </Card>

        <SectionTitle>Details</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          <Input label="Plugins used" value={pluginsText} onChangeText={setPluginsText} placeholder="Dataview, Templater, Calendar" hint="Comma separated. Buyers filter by these." />
          <Input label="Tags" value={tagsText} onChangeText={setTagsText} placeholder="para, zettelkasten, dashboard" hint="Up to 10, comma separated." />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Input label="Number of notes" value={noteCount} onChangeText={setNoteCount} keyboardType="number-pad" placeholder="120" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Version" value={version} onChangeText={setVersion} placeholder="1.0" />
            </View>
          </View>
        </Card>

        <SectionTitle>Cover image</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          <Pressable onPress={pickCover} style={styles.coverPicker}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={styles.coverImage} contentFit="cover" />
            ) : (
              <View style={[styles.coverImage, styles.coverPlaceholder]}>
                <Text style={styles.coverMonogram}>
                  {title
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase() ?? '')
                    .join('') || 'AB'}
                </Text>
              </View>
            )}
            <View style={styles.coverOverlay}>
              <Ionicons name="image-outline" size={16} color={colors.text} />
              <Text style={styles.coverOverlayText}>{uploadingCover ? 'Uploading...' : coverUrl ? 'Change cover' : 'Add cover image (optional)'}</Text>
            </View>
          </Pressable>
          <Text style={styles.help}>Without a cover, listings show a monogram of the title.</Text>
          {coverUrl ? (
            <Button title="Remove cover" small variant="ghost" onPress={() => setCoverUrl(null)} />
          ) : null}
        </Card>

        <View style={styles.actions}>
          <Button title={existing?.status === 'published' ? 'Save changes' : 'Publish'} icon="rocket-outline" onPress={() => save(true)} loading={saving === 'publish'} />
          {existing?.status !== 'published' ? (
            <Button title="Save as draft" variant="secondary" onPress={() => save(false)} loading={saving === 'draft'} />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  help: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fileName: { color: colors.text, fontWeight: '700' },
  fileMeta: { color: colors.muted, fontSize: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  payout: { backgroundColor: colors.successSoft, padding: spacing.md, borderRadius: radius.md },
  payoutText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  payoutStrong: { color: colors.success, fontWeight: '700' },
  coverPicker: { borderRadius: radius.md, overflow: 'hidden' },
  coverImage: { width: '100%', height: 160 },
  coverPlaceholder: { backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  coverMonogram: { color: colors.text, fontSize: 44, fontWeight: '700', letterSpacing: -1 },
  coverOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 8,
  },
  coverOverlayText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
