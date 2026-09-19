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

      <h3>How an uploaded vault is checked</h3>
      <p>
        A vault you upload is other people&rsquo;s download, so it is inspected by machine before it is stored. No person reads your notes as part of this.
      </p>
      <ul>
        <li>
          The archive goes first to a temporary holding store, where it waits its turn. It is deleted from there as soon as it has been processed, and in
          any case within a day.
        </li>
        <li>
          Every archive is deep-scanned for malware by an automated scanner (ClamAV) that opens the archive and examines every file inside it. An archive
          that fails is refused and deleted; we keep a log entry recording your account, the time and the name of what was detected.
        </li>
        <li>
          Only text files are accepted: <code>.md</code>, <code>.canvas</code>, <code>.base</code>, <code>.json</code>, <code>.yaml</code>/<code>.yml</code>,{' '}
          <code>.toml</code> and <code>.txt</code>. Each file is checked by its contents as well as its name, so an image or program renamed to look like a
          note is refused. A refused archive is deleted, and you are told which file was the reason.
        </li>
        <li>
          An archive that passes is unpacked into our object storage: the notes, so buyers can read them and connect over MCP, and the archive itself, which is
          what buyers download. Uploads you never attach to a listing are deleted after two days.
        </li>
        <li>
          The scanner runs on our own infrastructure. Your files are not sent to any third-party scanning service.
        </li>
      </ul>
      <p>
        We also record how much storage your listings occupy and which storage plan you are on, to enforce the limit that plan allows.
      </p>

      <h3>When you connect over MCP</h3>
      <p>
        Personal access tokens are stored as a SHA-256 hash. We cannot read a token back, which is why a lost token must be regenerated rather than recovered.
        Requests from your AI client are authenticated against that hash, and their content is not logged.
      </p>

      <h3>When you sign in</h3>
      <p>
        After your password, we email you a one-time code. The code is held for a few minutes in a short-lived store and destroyed once used or expired. The
        email is sent through Brevo, which receives your address for that purpose only.
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
          <strong>Supabase.</strong> Hosts accounts, purchases, orders and vault listings.
        </li>
        <li>
          <strong>Our object storage.</strong> Holds the vault files, note contents and cover images that sellers upload, and, briefly, archives waiting to
          be scanned.
        </li>
        <li>
          <strong>Brevo.</strong> Sends our transactional email: sign-in codes and account notices. It receives your email address and the message.
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
        <li>Uploaded archives leave the temporary holding store as soon as they are processed, and within a day at most.</li>
        <li>Uploads never attached to a listing are deleted after two days; a listing&rsquo;s files are deleted when the listing is.</li>
        <li>Sign-in codes expire within minutes and are not retained.</li>
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
        <li>Every uploaded vault is scanned for malware and checked file by file before it is stored or offered to anyone.</li>
        <li>Vault files are served through short-lived signed links that only work for buyers.</li>
        <li>Note bodies are returned only to the vault&rsquo;s buyers and its seller; previews are the only part shown before purchase.</li>
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
