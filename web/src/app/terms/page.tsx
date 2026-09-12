import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/Legal';
import { BUSINESS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The agreement between Vault Market, the people who buy vaults and the people who sell them.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of {BUSINESS.tradingName}, operated by {BUSINESS.legalName}. By creating an account, buying a vault or listing one, you
        accept them.
      </p>

      <h2>1. What the service is</h2>
      <p>
        {BUSINESS.tradingName} is a marketplace for Obsidian vaults: collections of markdown notes and templates. Sellers list and price their own vaults. We
        host the listings, take payment, deliver the files and pay sellers their share. We are not the author of the vaults and we do not review every one before
        it is published.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need an accurate email address and are responsible for what happens under your account, including keeping your password and MCP tokens private. You
        must be old enough to enter a contract where you live. We may suspend accounts used for fraud, abuse or infringement.
      </p>

      <h2>3. Buying</h2>
      <p>
        Prices are shown before payment and charged by our payment provider, who is the merchant of record for the sale. A purchase gives you a personal, non-exclusive, non-transferable licence to use the vault
        yourself: read it, edit it, build on it. You may not resell it, republish it, or share it publicly in whole or in substantial part. Access to download and
        to read the vault over MCP lasts as long as your account and the listing exist. <strong>Sales are final and we do not offer refunds</strong>; see the{' '}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>4. Selling</h2>
      <p>
        You keep ownership of what you upload and grant us the licence needed to display, store and deliver it to buyers. By listing a vault you confirm that it
        is yours to sell, that it contains no third-party paid content you lack rights to, no malware and no personal notes you did not intend to publish, and
        that the listing describes it honestly.
      </p>
      <p>
        We keep a commission on each paid sale, shown on the Sell page and applied at checkout; the rest is settled to you separately as your share. You are
        responsible for your own taxes. We may unlist a vault that breaks these terms or draws repeated complaints. Buyers who already paid keep access to what
        they bought.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Do not upload unlawful, infringing or malicious content, scrape or resell the catalogue, attempt to reach vaults you have not bought, or interfere with
        the service. Report suspected infringement to <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> and we will investigate and remove
        listings where the claim holds.
      </p>

      <h2>6. Availability</h2>
      <p>
        We aim to keep the service running but do not guarantee uninterrupted access. Features may change. If we discontinue the service we will give reasonable
        notice so you can download what you own.
      </p>

      <h2>7. Liability</h2>
      <p>
        Vaults are provided as they are. We do not warrant that a vault will suit your purpose. To the extent the law allows, our total liability for any claim is
        limited to the amount you paid for the vault it concerns. Nothing here limits liability that cannot be limited by law.
      </p>

      <h2>8. Changes and governing law</h2>
      <p>
        We may update these terms and will post the new version here with a fresh date. These terms are governed by the laws of India and disputes fall to{' '}
        {BUSINESS.jurisdiction}.
      </p>

      <h2>9. Contact</h2>
      <p>
        {BUSINESS.legalName}, {BUSINESS.address}. Email <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>.
      </p>
    </LegalPage>
  );
}
