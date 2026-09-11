import type { Metadata } from 'next';
import { LegalPage } from '@/components/Legal';
import { BUSINESS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Vault Market collects, why, who it is shared with, and how to have it deleted.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy covers the {BUSINESS.tradingName} website and mobile app. It describes what we collect, why we hold it, who else sees it, and how to get it
        removed. We do not sell personal data and we do not run advertising or analytics trackers.
      </p>

      <h2>What we collect</h2>
      <h3>When you create an account</h3>
      <p>Your email address and a password, plus a username and display name. An optional short bio and avatar if you add one.</p>

      <h3>When you buy a vault</h3>
      <p>
        The vault purchased, the amount, our commission, the payment and transfer identifiers returned by Razorpay, and the time of purchase. Card numbers,
        UPI IDs and bank credentials are entered on the payment provider&rsquo;s own checkout page and never reach our servers.
      </p>

      <h3>When you sell a vault</h3>
      <p>
        Your listing text, cover image and the notes inside the vault you upload. <strong>We no longer collect your PAN, address or bank account details.</strong>{' '}
        Vault Market is the seller of record to the buyer, so your share is settled with you separately as a supplier rather than paid out of the buyer&rsquo;s
        payment, and whatever details that settlement needs are exchanged outside this site.
      </p>

      <h3>When you connect over MCP</h3>
      <p>
        Personal access tokens are stored as a SHA-256 hash. We cannot read your token back, which is why a lost token must be regenerated rather than
        recovered. Requests from your AI client are authenticated against that hash and are not logged with their content.
      </p>

      <h3>Automatically</h3>
      <p>
        Standard server logs (IP address, timestamp, endpoint, error) kept for security and debugging, and download counts per vault. Your browser stores your
        session locally so you stay signed in. We use no advertising or analytics cookies.
      </p>

      <h2>Why we hold it</h2>
      <p>
        To run your account, deliver what you bought, pay sellers, meet tax and accounting obligations, answer support and payment disputes, and prevent fraud
        and abuse.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Dodo Payments</strong> — merchant of record for payments outside India: it takes the payment, issues the invoice and handles sales tax and VAT.
          Governed by Dodo Payments&rsquo; own privacy policy.
        </li>
        <li>
          <strong>Razorpay</strong> — payments taken in India. Governed by Razorpay&rsquo;s own privacy policy.
        </li>
        <li>
          <strong>Supabase</strong> — accounts, purchases and orders.
        </li>
        <li>
          <strong>Sanity</strong> — vault listings and note contents.
        </li>
        <li>
          <strong>Sellers</strong> — see aggregate sales and download counts for their own vaults. They do not see buyer names, emails or contact details.
        </li>
        <li>
          <strong>Authorities</strong> — where the law requires it.
        </li>
      </ul>
      <p>No one else. We do not sell or rent personal data.</p>

      <h2>How long we keep it</h2>
      <p>
        Account and purchase records last while your account is open, then as long as tax and accounting law requires (currently eight years in India) because
        they are records of a sale. Server logs are kept for a short operational period. MCP token hashes are deleted the moment you revoke a token.
      </p>

      <h2>Your choices</h2>
      <p>
        You can edit your profile at any time, revoke MCP tokens from the Connect page, and ask us to delete your account. Write to{' '}
        <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> and we will respond within {BUSINESS.responseDays} working days. Deleting an
        account removes your profile and access; purchase records are retained where the law requires, and vaults you already bought stop being downloadable.
        You may also ask for a copy of your data or for a mistake to be corrected.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted in transit. Passwords are hashed by our authentication provider and never visible to us. Access tokens are stored hashed. Vault
        files are served through short-lived signed links that only work for buyers.
      </p>

      <h2>Children</h2>
      <p>The service is not directed at children under 13, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>Material changes will be announced on this page with a new date above. Continuing to use the service means accepting the updated policy.</p>

      <h2>Contact</h2>
      <p>
        {BUSINESS.legalName}, {BUSINESS.address}. Email <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>.
      </p>
    </LegalPage>
  );
}
