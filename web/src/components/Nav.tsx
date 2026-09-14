'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '@/store/auth';

/** 16px stroke glyphs for the phone pane; the inline desktop links stay text-only. */
const ICONS: Record<string, ReactNode> = {
  explore: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  library: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M9 4h4.5A1.5 1.5 0 0 1 15 5.5V20H9" />
      <path d="m15 7 3.6-1.1a1.5 1.5 0 0 1 1.9 1l3.2 11.7-4.4 1.3" />
    </>
  ),
  sell: (
    <>
      <path d="M3 12.6V4.5A1.5 1.5 0 0 1 4.5 3h8.1a2 2 0 0 1 1.4.6l6.9 6.9a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0l-7-6.9A2 2 0 0 1 3 12.6z" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  mcp: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M6 7h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 16v5" />
    </>
  ),
};

const LINKS = [
  { href: '/', label: 'Explore', icon: 'explore' },
  { href: '/library', label: 'Library', icon: 'library' },
  { href: '/sell', label: 'Sell', icon: 'sell' },
  { href: '/connect', label: 'MCP', icon: 'mcp' },
];

/** Matches the phone breakpoint in globals.css, where the inline links give way to the pane. */
const PHONE = '(max-width: 640px)';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

export function Nav() {
  const pathname = usePathname();
  const { user, profile, isDemo, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  // Navigating anywhere closes the pane; so does widening the window past the phone breakpoint,
  // which would otherwise leave the page's scroll locked behind a pane that CSS no longer shows.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const onChange = (e: MediaQueryListEvent) => !e.matches && setOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) toggleRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    paneRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (profile?.displayName ?? user?.email ?? '?')[0]?.toUpperCase();

  return (
    <header className="nav" data-open={open || undefined}>
      <div className="nav-inner">
        <Link href="/" className="brand">
          Vault Market
        </Link>
        <nav className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(pathname, l.href) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        {isDemo ? <span className="demo-pill nav-desktop">DEMO</span> : null}
        {loading ? null : user ? (
          <Link href="/profile" className="row" title={user.email}>
            <span className="avatar">{initial}</span>
          </Link>
        ) : (
          <Link href="/auth" className="btn small secondary nav-desktop">
            Sign in
          </Link>
        )}
        <button
          ref={toggleRef}
          type="button"
          className="nav-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </div>

      <div className="nav-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="mobile-menu" ref={paneRef} className="nav-pane" role="dialog" aria-modal="true" aria-label="Menu" inert={!open}>
        <nav className="nav-pane-links">
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className={isActive(pathname, l.href) ? 'active' : ''}
              style={{ '--i': i } as CSSProperties}
            >
              <svg
                className="nav-pane-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {ICONS[l.icon]}
              </svg>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="nav-pane-foot" style={{ '--i': LINKS.length } as CSSProperties}>
          {loading ? null : user ? (
            <Link href="/profile" className="nav-account">
              <span className="avatar">{initial}</span>
              <span className="grow">
                <span className="nav-account-name truncate">{profile?.displayName ?? 'Your profile'}</span>
                <span className="muted small truncate">{user.email}</span>
              </span>
            </Link>
          ) : (
            <Link href="/auth" className="btn block">
              Sign in
            </Link>
          )}
          {isDemo ? <span className="demo-pill">DEMO</span> : null}
        </div>
      </aside>
    </header>
  );
}
