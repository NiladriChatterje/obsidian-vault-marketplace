import type { Metadata } from 'next';
import { LegalPage } from '@/components/Legal';
import { BUSINESS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: 'Vault Market sales are final. Cancel before paying; after payment there are no refunds.',
};

/**
 * All sales final. The page stays because payment providers check that a refund and
 * cancellation policy exists before activating an account, and because a buyer is entitled
 * to know the position before they pay rather than after.
 */
export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy">
      <p>
        <strong>Sales are final.</strong> A vault is delivered the moment you pay: the whole contents are downloadable and readable straight away, so there is
        nothing to return. Please read the listing, open the preview notes and check the plugin requirements before buying.
      </p>

      <h2>Cancelling before payment</h2>
      <p>
        You can abandon checkout at any point before paying. Closing the checkout window cancels the order, no money is taken and nothing is added to your
        library. This is the only point at which a purchase can be called off.
      </p>

      <h2>After payment</h2>
      <p>
        We do not offer refunds, returns or exchanges once a payment has gone through. That includes changing your mind, buying the wrong vault, finding the
        vault does not suit your workflow, or not having the Obsidian plugins the listing names as requirements. Free vaults involve no payment and so have
        nothing to refund.
      </p>
      <p>
        Every paid listing shows preview notes you can read without buying, the note count, the size and the plugins it needs. Use them. They exist so that what
        you get is clear beforehand.
      </p>

      <h2>If something has gone wrong</h2>
      <p>
        This policy is about buyer&rsquo;s remorse, not about us failing to deliver. If you were charged and the vault never appeared in your library, or you
        were charged more than once, that is a fault on our side and not a refund request. Write to{' '}
        <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> with the email on your account, the vault name and the payment identifier from
        your receipt, and we will look into it and put it right. We reply within {BUSINESS.responseDays} working days.
      </p>

      <h2>Chargebacks</h2>
      <p>
        Please write to us before raising a chargeback with your bank. If a payment genuinely failed we can usually sort it out the same day, and a chargeback
        is slower for everyone. Accounts used to charge back completed purchases are closed and lose access to everything bought through them.
      </p>

      <h2>Sellers</h2>
      <p>
        If a payment is ever reversed, whether by the payment provider or by a card network, the sale is reversed against the seller&rsquo;s earnings and our
        commission on it is reversed too. Sellers who misdescribe what a vault contains are removed from the marketplace.
      </p>
    </LegalPage>
  );
}
