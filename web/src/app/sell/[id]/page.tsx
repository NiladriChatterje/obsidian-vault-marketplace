'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Cover, Field, Loading, Toast } from '@/components/ui';
import { errorMessage, fileToUri, releaseUri } from '@/lib/web';
import { inspectVaultZip } from '@/lib/vault-zip';
import { api } from '@/lib/api';
import { MAX_VAULT_ZIP_BYTES, MIN_PRICE_CENTS, PLATFORM_FEE_PERCENT } from '@/lib/config';
import { formatBytes, formatPrice, parsePriceToCents, parseTags } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { CATEGORIES, type CategorySlug, type Vault, type VaultInput } from '@/types';

/** Create (id = "new") or edit a listing. Mirrors app/sell/[id].tsx in the Expo app. */
export default function ListingEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, profile, loading: authLoading, isDemo } = useAuth();
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
  const [error, setError] = useState<string | null>(null);
  // A zip refused before it is uploaded. The picker sits at the top of a long form, so the
  // page's error banner further down would not be seen.
  const [rejected, setRejected] = useState<string | null>(null);
  // Whether the seller can be paid at all. The server refuses to publish a paid vault
  // without it; checking here means the refusal arrives before the save round trip.
  const [canBePaid, setCanBePaid] = useState<boolean | null>(null);

  const zipInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

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
      .catch((e) => setError(errorMessage(e, 'Could not load listing')))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const priceCents = isPaid ? parsePriceToCents(priceText) : 0;
  const priceError = isPaid && (priceCents === null || priceCents < MIN_PRICE_CENTS) ? `Minimum price is ${formatPrice(MIN_PRICE_CENTS)}` : null;
  const youKeep = priceCents ? Math.round(priceCents * (1 - PLATFORM_FEE_PERCENT / 100)) : 0;

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploadingCover(true);
    setError(null);
    const uri = fileToUri(file);
    try {
      setCoverUrl(await api.uploadCover(uri));
    } catch (e) {
      setError(errorMessage(e, 'Cover upload failed.'));
    } finally {
      releaseUri(uri);
      setUploadingCover(false);
    }
  };

  useEffect(() => {
    if (!user || isDemo) return setCanBePaid(true);
    api
      .getPayoutDetails()
      .then(({ details }) => setCanBePaid(!!details))
      // Unknown rather than false, so a failed check never blocks a publish the server allows.
      .catch(() => setCanBePaid(null));
  }, [user?.id, isDemo]);

  const pickZip = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) return setRejected('Zip files only. Export your vault folder as a .zip archive first.');
    if (file.size > MAX_VAULT_ZIP_BYTES) return setRejected(`Vault archives must be under ${formatBytes(MAX_VAULT_ZIP_BYTES)}.`);

    setUploadingFile(true);
    setError(null);
    setRejected(null);
    // Read the archive here rather than letting the server refuse it after a long upload.
    // It applies the same rules and stays the authority; this only saves the wait.
    try {
      const check = await inspectVaultZip(file);
      if (!check.ok) {
        setRejected(check.reason ?? 'That zip is not an Obsidian vault.');
        setUploadingFile(false);
        return;
      }
    } catch {
      // Unreadable here for some other reason; let the server have the final say.
    }

    const uri = fileToUri(file);
    try {
      const uploaded = await api.uploadVaultFile(uri, file.name);
      setFilePath(uploaded.path);
      setFileName(file.name);
      setSizeBytes(uploaded.sizeBytes || file.size);
    } catch (e) {
      setError(errorMessage(e, 'Upload failed.'));
    } finally {
      releaseUri(uri);
      setUploadingFile(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!user) return router.push(`/auth?next=/sell/${id}`);
    if (title.trim().length < 3) return setError('Give the vault a clear name (at least 3 characters).');
    if (tagline.trim().length < 10) return setError('Add a one-sentence tagline that says who it is for.');
    if (description.trim().length < 40) return setError('Tell buyers what is inside. At least a couple of sentences.');
    if (priceError || priceCents === null) return setError(priceError ?? 'Enter a valid price.');
    if (publish && !filePath) return setError('Attach the .zip before publishing. You can still save a draft.');
    if (publish && priceCents > 0 && canBePaid === false) {
      return setRejected('Add your payout details before publishing a paid vault. Nobody can pay you until we know where to send your share. You can save it as a draft, or set the price to free.');
    }

    setSaving(publish ? 'publish' : 'draft');
    setError(null);
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
      router.push('/sell');
    } catch (e) {
      setError(errorMessage(e, 'Could not save.'));
    } finally {
      setSaving(null);
    }
  };

  if (authLoading || loading) return <Loading />;
  if (!user || (profile && !profile.isSeller)) {
    return (
      <div className="empty">
        <h3>Sellers only</h3>
        <p>
          <Link href="/sell" className="btn" style={{ marginTop: 12 }}>
            Become a seller
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="narrow stack" style={{ margin: '0 auto', gap: 20 }}>
      <div className="row between">
        <h1>{isNew ? 'New listing' : 'Edit listing'}</h1>
        <Link href="/sell" className="btn ghost small">
          Cancel
        </Link>
      </div>

      <section className="card stack">
        <h3>Vault file</h3>
        {filePath ? (
          <div className="row between">
            <div className="grow">
              <div className="truncate">{fileName}</div>
              <div className="muted small">{sizeBytes ? formatBytes(sizeBytes) : 'Uploaded'}</div>
            </div>
          </div>
        ) : (
          <p className="help">Zip your vault folder (including .obsidian if your setup depends on it). Remove personal notes first. Buyers download this zip or read it over MCP.</p>
        )}
        <input ref={zipInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(e) => pickZip(e.target.files?.[0])} />
        <div>
          <button type="button" className="btn secondary" onClick={() => zipInput.current?.click()} disabled={uploadingFile}>
            {uploadingFile ? 'Uploading…' : filePath ? 'Replace .zip' : 'Upload .zip'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h3>Cover</h3>
        <div style={{ maxWidth: 320 }}>
          <Cover vault={{ title: title || 'Vault', coverUrl }} />
        </div>
        <input ref={coverInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => pickCover(e.target.files?.[0])} />
        <div>
          <button type="button" className="btn secondary" onClick={() => coverInput.current?.click()} disabled={uploadingCover}>
            {uploadingCover ? 'Uploading…' : coverUrl ? 'Replace cover' : 'Upload cover (16:9)'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h3>Basics</h3>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Second Brain OS" maxLength={60} />
        </Field>
        <Field label="Tagline">
          <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="A PARA + Zettelkasten system with dashboards that run themselves" maxLength={120} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is inside, who it is for, how to get started…" />
        </Field>
        <div className="field">
          <span className="label">Category</span>
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button key={c.slug} type="button" className={`chip${category === c.slug ? ' selected' : ''}`} onClick={() => setCategory(c.slug)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h3>Price</h3>
        <label className="switch">
          <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} /> Paid vault
        </label>
        {isPaid ? (
          <Field label="Price (INR)" hint={priceError ?? (priceCents ? `You keep ${formatPrice(youKeep)} per sale after the ${PLATFORM_FEE_PERCENT}% fee.` : undefined)}>
            <input className="input" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
          </Field>
        ) : (
          <p className="help">Free vaults are the best funnel to your paid ones.</p>
        )}
      </section>

      <section className="card stack">
        <h3>Details</h3>
        <Field label="Tags" hint="Comma separated, up to 10.">
          <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="para, zettelkasten, dataview" />
        </Field>
        <Field label="Plugins used" hint="Comma separated.">
          <input className="input" value={pluginsText} onChange={(e) => setPluginsText(e.target.value)} placeholder="Dataview, Templater" />
        </Field>
        <div className="row">
          <Field label="Note count">
            <input className="input" inputMode="numeric" value={noteCount} onChange={(e) => setNoteCount(e.target.value)} placeholder="148" />
          </Field>
          <Field label="Version">
            <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" />
          </Field>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <div className="row">
        <button className="btn secondary" onClick={() => save(false)} disabled={!!saving}>
          {saving === 'draft' ? 'Saving…' : existing?.status === 'published' ? 'Save changes' : 'Save draft'}
        </button>
        {existing?.status !== 'published' ? (
          <button className="btn" onClick={() => save(true)} disabled={!!saving}>
            {saving === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        ) : null}
      </div>

      {rejected ? (
        <Toast title="That zip is not an Obsidian vault" message={rejected} onClose={() => setRejected(null)} />
      ) : null}
    </div>
  );
}
