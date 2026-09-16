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
        This policy covers the {BUSINESS.tradingName} website and mobile app. It explains what we collect, why we hold it, who else sees it and how to have it
        removed. We do not sell personal data, and we run no advertising or analytics trackers.
      </p>

      <h2>What we collect</h2>

      <h3>When you create an account</h3>
      <ul>
        <li>Your email address and a password.</li>
        <li>A username and a display name.</li>
        <li>A short bio and an avatar, if you choose to add them.</li>
      </ul>

      <h3>When you buy a vault</h3>
      <p>
        Card numbers, UPI IDs and bank credentials are entered on Dodo Payments&rsquo; own checkout page and never reach our servers. For each purchase we
        record:
      </p>
      <ul>
        <li>The vault purchased and the time of purchase.</li>
        <li>The amount paid and our commission on it.</li>
        <li>The payment identifier returned by Dodo Payments.</li>
        <li>The country the payment came from.</li>
      </ul>

      <h3>When you sell a vault</h3>
      <p>
        Your listing text, cover image and the notes inside the vault you upload. {BUSINESS.tradingName} is the seller of record to the buyer, so your share is
        settled with you separately rather than paid out of the buyer&rsquo;s payment. To do that we hold the payout details you enter:
      </p>
      <ul>
        <li>The currency you want to be paid in and how you want to be paid.</li>
        <li>The name on the account.</li>
        <li>The account itself: an account number or IBAN for a bank transfer, or the email address on your Wise, Payoneer or PayPal account otherwise.</li>
        <li>For a bank transfer, the code your bank uses, such as an IFSC, sort code, routing number or SWIFT code.</li>
        <li>Any note you choose to add about the account.</li>
      </ul>
      <p>
        <strong>We do not ask for your PAN or any government identity document.</strong> Payout details are readable only by you and by the server that pays
        you. They are never shown publicly, attached to your listings or shared with buyers.
      </p>

      <h3>When you connect over MCP</h3>
      <p>
        Personal access tokens are stored as a SHA-256 hash. We cannot read a token back, which is why a lost token must be regenerated rather than recovered.
        Requests from your AI client are authenticated against that hash, and their content is not logged.
      </p>

      <h3>As you use the service</h3>
      <ul>
        <li>Standard server logs, covering the IP address, timestamp, endpoint and any error, kept for security and debugging.</li>
        <li>Download counts per vault.</li>
        <li>A session your browser stores locally so you stay signed in.</li>
      </ul>
      <p>We use no advertising or analytics cookies.</p>

      <h2>Why we hold it</h2>
      <ul>
        <li>To run your account and deliver what you bought.</li>
        <li>To pay sellers their share.</li>
        <li>To meet tax and accounting obligations.</li>
        <li>To answer support requests and payment disputes.</li>
        <li>To prevent fraud and abuse.</li>
      </ul>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Dodo Payments.</strong> The merchant of record for every sale. It takes the payment, issues the invoice, and registers and remits sales tax
          and VAT in the buyer&rsquo;s country. It receives your email address and the billing details you enter at checkout, under its own privacy policy.
        </li>
        <li>
          <strong>Supabase.</strong> Hosts accounts, purchases and orders.
        </li>
        <li>
          <strong>Sanity.</strong> Hosts vault listings and note contents.
        </li>
        <li>
          <strong>Sellers.</strong> See aggregate sales and download counts for their own vaults only. They never see buyer names, email addresses or contact
          details.
        </li>
        <li>
          <strong>Authorities.</strong> Only where the law requires it.
        </li>
      </ul>
      <p>No one else. We do not sell or rent personal data.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account and purchase records last while your account is open, and then for as long as tax and accounting law requires, because they are records of
          a sale. In India that is currently eight years.
        </li>
        <li>Server logs are kept for a short operational period.</li>
        <li>MCP token hashes are deleted the moment you revoke a token.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile at any time.</li>
        <li>Revoke MCP tokens from the Connect page.</li>
        <li>Ask us to delete your account, to send you a copy of your data, or to correct a mistake.</li>
      </ul>
      <p>
        Write to <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> and we will respond within {BUSINESS.responseDays} working days.
        Deleting an account removes your profile and access. Purchase records are retained where the law requires, and vaults you already bought stop being
        downloadable.
      </p>

      <h2>Security</h2>
      <ul>
        <li>Traffic is encrypted in transit.</li>
        <li>Passwords are hashed by our authentication provider and are never visible to us.</li>
        <li>Access tokens are stored hashed.</li>
        <li>Vault files are served through short-lived signed links that only work for buyers.</li>
      </ul>

      <h2>Children</h2>
      <p>The service is not directed at children under 13, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>Material changes will be announced on this page with a new date above. Continuing to use the service means accepting the updated policy.</p>

      <h2>Contact</h2>
      <p className="legal-contact">
        {BUSINESS.legalName}
        <br />
        {BUSINESS.address}
        <br />
        <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>
      </p>
    </LegalPage>
  );
}
