import type { Metadata } from 'next';
import { LegalPage } from '@/components/Legal';
import { BUSINESS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: 'When a Vault Market purchase can be cancelled or refunded, and how to request one.',
};

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy">
      <p>
        Vaults are digital goods delivered immediately. This page sets out the narrow cases where a purchase can be cancelled or refunded, and how to ask for
        one.
      </p>

      <h2>Cancelling before payment</h2>
      <p>
        You can abandon checkout at any point before paying. Closing the Razorpay window cancels the order and no money is taken. Nothing is added to your
        library.
      </p>

      <h2>After payment: sales are final</h2>
      <p>
        Once a paid vault has been downloaded or opened over MCP, the content is in your hands and cannot be returned, so the sale is final. Free vaults involve
        no payment and nothing to refund.
      </p>

      <h2>When we do refund</h2>
      <ul>
        <li>
          <strong>Duplicate or failed payment.</strong> You were charged twice, or money left your account but the vault never appeared in your library. Refunded
          in full.
        </li>
        <li>
          <strong>Undelivered vault.</strong> The download or MCP access does not work and we cannot fix it within {BUSINESS.responseDays} working days.
          Refunded in full.
        </li>
        <li>
          <strong>Materially misdescribed vault.</strong> What you received is substantially different from the listing, for example a fraction of the promised
          notes or a corrupt archive. Reported within 7 days of purchase and refunded in full after we check the vault.
        </li>
        <li>
          <strong>Unauthorised payment.</strong> Confirmed fraud on your card or account. Refunded and the account is secured.
        </li>
      </ul>

      <h2>When we do not</h2>
      <ul>
        <li>You changed your mind, or bought the wrong vault by mistake.</li>
        <li>The vault works as described but does not suit your workflow or taste.</li>
        <li>You lack the Obsidian plugins the listing names as requirements.</li>
        <li>You can no longer access the vault because your own account was deleted or suspended for abuse.</li>
      </ul>

      <h2>How to request one</h2>
      <p>
        Email <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> with the email on your account, the vault name and the payment
        identifier from your receipt. We reply within {BUSINESS.responseDays} working days. Approved refunds go back to the original payment method within{' '}
        {BUSINESS.refundDays} working days; how quickly it appears is then up to your bank.
      </p>

      <h2>Sellers</h2>
      <p>
        A refunded sale is reversed against the seller&rsquo;s earnings, and our commission on it is reversed too. Sellers who repeatedly misdescribe vaults are
        removed from the marketplace.
      </p>

      <h2>Disputes</h2>
      <p>
        Please write to us before raising a chargeback with your bank. Most problems are payment failures we can fix the same day, and a chargeback is slower for
        everyone.
      </p>
    </LegalPage>
  );
}
