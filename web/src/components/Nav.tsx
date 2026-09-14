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

/** How far a rifted row's line steps in from the outer line, in px. Labels stay put. */
const RIFT = 14;
const RAIL_X = [3, 3 + RIFT];

/**
 * One row's slice of the rail down the left of the pane. Every row draws a line at its own depth,
 * and a row whose depth differs from the one above bends across to it in the top 10px, so stacked
 * rows read as one continuous line that rifts in and out.
 */
function RailSegment({ from, to }: { from: number | null; to: number }) {
  const x = RAIL_X[to];
  if (from === null || from === to) {
    return (
      <svg className="nav-pane-rail" aria-hidden="true">
        <line x1={x} y1="0" x2={x} y2="100%" />
      </svg>
    );
  }
  const px = RAIL_X[from];
  return (
    <svg className="nav-pane-rail" aria-hidden="true">
      <path d={`M${px} 0 C${px} 6.5 ${x} 3.5 ${x} 10`} />
      <line x1={x} y1="10" x2={x} y2="100%" />
    </svg>
  );
}

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
          {LINKS.map((l, i) => {
            const rift = i % 2;
            const classes = [isActive(pathname, l.href) && 'active', i > 0 && 'jog'].filter(Boolean).join(' ');
            return (
              <Link key={l.href} href={l.href} className={classes} style={{ '--i': i, '--x': rift } as CSSProperties}>
                <RailSegment from={i > 0 ? (i - 1) % 2 : null} to={rift} />
                <span className="nav-pane-label">{l.label}</span>
              </Link>
            );
          })}
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
