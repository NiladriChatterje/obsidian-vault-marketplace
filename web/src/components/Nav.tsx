'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/store/auth';

const LINKS = [
  { href: '/', label: 'Explore' },
  { href: '/library', label: 'Library' },
  { href: '/sell', label: 'Sell' },
  { href: '/connect', label: 'MCP' },
];

export function Nav() {
  const pathname = usePathname();
  const { user, profile, isDemo, loading } = useAuth();

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          Vault Market
        </Link>
        <nav className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href)) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        {isDemo ? <span className="demo-pill">DEMO</span> : null}
        {loading ? null : user ? (
          <Link href="/profile" className="row" title={user.email}>
            <span className="avatar">{(profile?.displayName ?? user.email)[0]?.toUpperCase()}</span>
          </Link>
        ) : (
          <Link href="/auth" className="btn small secondary">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
