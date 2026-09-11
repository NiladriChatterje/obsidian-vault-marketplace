import Link from 'next/link';
import { BUSINESS } from '@/lib/legal';

const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds & Cancellation' },
  { href: '/contact', label: 'Contact' },
];

/** Payment providers' activation reviews look for these links from every page. */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span className="muted small">
          © {new Date().getFullYear()} {BUSINESS.legalName}
        </span>
        <nav className="row wrap">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="muted small">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
