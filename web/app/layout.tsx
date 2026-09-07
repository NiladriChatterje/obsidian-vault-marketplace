import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Vault Market', template: '%s · Vault Market' },
  description: 'Ready-made Obsidian vaults from people who live in them. Buy, download, or connect over MCP.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="container">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
