'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CopyButton, Empty, ErrorBox, Loading } from '@/components/ui';
import { createMcpToken, hasMcpToken, revokeMcpToken } from '@/lib/mcp-token';
import { errorMessage } from '@/lib/web';
import { API_URL } from '@/lib/config';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function ConnectPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Connect />
    </Suspense>
  );
}

function Connect() {
  const params = useSearchParams();
  const highlight = params.get('vault');
  const { user, loading, isDemo } = useAuth();
  const library = useAsync(() => (user ? api.getLibrary() : Promise.resolve([])), [user?.id]);
  const existing = useAsync(() => (user ? hasMcpToken() : Promise.resolve(false)), [user?.id]);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<'claude-code' | 'claude-desktop' | 'cursor'>('claude-code');

  const endpoint = `${API_URL}/mcp`;
  const shownToken = token ?? '<your token>';

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setToken(await createMcpToken());
      await existing.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm('Revoke the current token? Connected assistants will lose access until you generate a new one.')) return;
    setBusy(true);
    try {
      await revokeMcpToken();
      setToken(null);
      await existing.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to connect your vaults"
        message="MCP gives your AI assistant read access to every vault you own."
        action={
          <Link href="/auth?next=/connect" className="btn">
            Sign in
          </Link>
        }
      />
    );
  }

  const highlighted = highlight ? library.data?.find((p) => p.vaultId === highlight)?.vault : undefined;

  const snippets = {
    'claude-code': `claude mcp add --transport http vault-market ${endpoint} \\
  --header "Authorization: Bearer ${shownToken}"`,
    'claude-desktop': JSON.stringify(
      {
        mcpServers: {
          'vault-market': {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${shownToken}` },
          },
        },
      },
      null,
      2
    ),
    cursor: JSON.stringify(
      {
        mcpServers: {
          'vault-market': {
            url: endpoint,
            headers: { Authorization: `Bearer ${shownToken}` },
          },
        },
      },
      null,
      2
    ),
  };

  return (
    <div className="narrow stack" style={{ margin: '0 auto', gap: 20 }}>
      <div>
        <h1>Connect over MCP</h1>
        <p className="muted">
          One endpoint exposes every vault you own to any Model Context Protocol client. Your assistant can list notes, read them and search across a vault without you unzipping anything.
        </p>
      </div>

      {highlighted ? <div className="notice">“{highlighted.title}” is in your library and ready to connect.</div> : null}

      <section className="card stack">
        <h3>1. Your access token</h3>
        {error ? <div className="error">{error}</div> : null}
        {token ? (
          <>
            <div className="copyable">
              <pre className="code">{token}</pre>
              <CopyButton text={token} label="Copy token" />
            </div>
            <p className="help">Copy it now. For security only a hash is stored, so it cannot be shown again. Generate a new one any time.</p>
          </>
        ) : existing.data ? (
          <p className="help">You already have a token. If you lost it, generate a new one (the old one stops working).</p>
        ) : (
          <p className="help">Tokens are personal and grant read access to the vaults you own, nothing else.</p>
        )}
        {isDemo ? <p className="help">Demo mode: the endpoint accepts this demo token and serves the sample vaults.</p> : null}
        <div className="row">
          <button className="btn" onClick={generate} disabled={busy}>
            {busy ? 'Working…' : existing.data || token ? 'Generate new token' : 'Generate token'}
          </button>
          {existing.data && !isDemo ? (
            <button className="btn danger" onClick={revoke} disabled={busy}>
              Revoke
            </button>
          ) : null}
        </div>
      </section>

      <section className="card stack">
        <h3>2. Add the server to your client</h3>
        <div className="tabs">
          {(
            [
              ['claude-code', 'Claude Code'],
              ['claude-desktop', 'Claude Desktop'],
              ['cursor', 'Cursor'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={client === k ? 'active' : ''} onClick={() => setClient(k)}>
              {label}
            </button>
          ))}
        </div>
        <pre className="code">{snippets[client]}</pre>
        <p className="help">
          Endpoint: <span className="mono">{endpoint}</span> (Streamable HTTP). Tools: <span className="mono">list_vaults</span>, <span className="mono">list_notes</span>,{' '}
          <span className="mono">read_note</span>, <span className="mono">search_notes</span>.
        </p>
      </section>

      <section className="stack">
        <h3>Vaults available over MCP</h3>
        {library.error ? <ErrorBox message={library.error} onRetry={library.refresh} /> : null}
        {library.loading && !library.data ? <Loading /> : null}
        {library.data && library.data.length === 0 ? (
          <Empty
            title="No vaults yet"
            message="Buy or grab a free vault and it appears here automatically."
            action={
              <Link href="/browse" className="btn">
                Browse vaults
              </Link>
            }
          />
        ) : null}
        {library.data?.map((p) =>
          p.vault ? (
            <Link key={p.id} href={`/vault/${p.vaultId}`} className="row between card" style={{ padding: '10px 14px' }}>
              <span className="truncate">{p.vault.title}</span>
              <span className="mono muted">{p.vaultId}</span>
            </Link>
          ) : null
        )}
      </section>
    </div>
  );
}
