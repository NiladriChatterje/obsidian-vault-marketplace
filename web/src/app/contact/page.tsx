import type { Metadata } from 'next';
import { LegalPage } from '@/components/Legal';
import { BUSINESS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach Vault Market about a purchase, a payment or a listing.',
};

export default function ContactPage() {
  return (
    <LegalPage title="Contact">
      <p>
        One inbox handles everything: purchases, payments, payouts and takedown requests. We reply within {BUSINESS.responseDays} working days.
      </p>

      <h2>Email</h2>
      <p>
        <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>
      </p>

      <h2>Registered address</h2>
      <p>
        {BUSINESS.legalName}
        <br />
        {BUSINESS.address}
      </p>

      <h2>What to include</h2>
      <ul>
        <li>
          <strong>A purchase or refund:</strong> the email on your account, the vault name and the payment identifier from your receipt.
        </li>
        <li>
          <strong>A payout:</strong> your seller username and the date of the sale in question.
        </li>
        <li>
          <strong>A copyright or content complaint:</strong> the listing URL, what is wrong with it, and your basis for the claim.
        </li>
      </ul>
    </LegalPage>
  );
}
