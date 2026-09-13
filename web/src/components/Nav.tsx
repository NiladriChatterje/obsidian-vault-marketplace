'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/store/auth';

const LINKS = [
  { href: '/', label: 'Explore' },
  { href: '/library', label: 'Library' },
  { href: '/sell', label: 'Sell' },
  { href: '/connect', label: 'MCP' },
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
              <span className="nav-pane-index mono">{String(i + 1).padStart(2, '0')}</span>
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
