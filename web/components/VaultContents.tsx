'use client';

import { useState } from 'react';
import { ErrorBox, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@shared/hooks/useAsync';
import { api } from '@shared/lib/api';
import { formatBytes } from '@shared/lib/format';
import type { VaultNote, VaultNoteContent } from '@shared/types';

/**
 * The files inside a vault, grouped by folder, with an inline reader.
 * Preview notes open for everyone; the rest open once the vault is owned.
 */
export function VaultContents({ vaultId, owned }: { vaultId: string; owned: boolean }) {
  const notes = useAsync(() => api.getVaultNotes(vaultId), [vaultId]);
  const [open, setOpen] = useState<VaultNoteContent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (notes.loading && !notes.data) return <Loading label="Loading contents…" />;
  if (notes.error) return <ErrorBox message={notes.error} onRetry={notes.refresh} />;
  if (!notes.data?.length) return null;

  const groups = new Map<string, VaultNote[]>();
  for (const n of notes.data) {
    const list = groups.get(n.folder) ?? [];
    list.push(n);
    groups.set(n.folder, list);
  }
  const folders = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  const openNote = async (n: VaultNote) => {
    if (!n.isPreview && !owned) return;
    setBusy(n.path);
    setError(null);
    try {
      setOpen(await api.getNote(vaultId, n.path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="stack">
      <div className="row between">
        <h2>Inside the vault</h2>
        <span className="muted small">
          {notes.data.length} notes · {formatBytes(notes.data.reduce((s, n) => s + n.sizeBytes, 0))}
        </span>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="card stack" style={{ gap: 4 }}>
        {folders.map((folder) => (
          <div key={folder || '/'}>
            {folder ? (
              <div className="muted small" style={{ padding: '8px 0 2px', fontWeight: 600 }}>
                {folder}/
              </div>
            ) : null}
            {groups.get(folder)!.map((n) => {
              const readable = n.isPreview || owned;
              return (
                <button
                  key={n.path}
                  className="row between"
                  onClick={() => openNote(n)}
                  disabled={!readable || busy === n.path}
                  style={{
                    width: '100%',
                    background: open?.path === n.path ? 'var(--raised)' : 'transparent',
                    border: 0,
                    borderRadius: 6,
                    padding: '6px 8px',
                    textAlign: 'left',
                    cursor: readable ? 'pointer' : 'default',
                    opacity: readable ? 1 : 0.6,
                  }}
                >
                  <span className="truncate">{n.title}</span>
                  <span className="row muted small">
                    {n.isPreview ? <span className="tag">preview</span> : !owned ? <span className="tag">locked</span> : null}
                    <span>{formatBytes(n.sizeBytes)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {open ? (
        <div className="card stack">
          <div className="row between">
            <strong className="mono">{open.path}</strong>
            <button className="btn ghost small" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          {open.tags.length ? (
            <div className="chips">
              {open.tags.map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
          <pre className="code" style={{ whiteSpace: 'pre-wrap', maxHeight: 480 }}>
            {open.content}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
