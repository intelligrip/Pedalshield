/**
 * Marketplace catalog — bike services, digital goods, and redeemable vouchers,
 * priced in ZEC. Riders spend the shielded ZEC they earned by riding.
 *
 * NON-CUSTODIAL: each item carries the merchant's own Unified Address. The
 * rider pays the merchant directly from their wallet; Pedalshield never holds
 * funds or touches keys. We lead with "private-native" goods (services /
 * digital / vouchers) that need no shipping address — physical parts (which
 * reintroduce PII) come later. See docs/MARKETPLACE_DESIGN.md.
 *
 * The listings below are SAMPLE entries for the beta; real merchant onboarding
 * (a shop + a view-only key) is the next phase.
 */

export type MarketCategory = 'service' | 'digital' | 'voucher';

export interface MarketItem {
  id: string;
  title: string;
  merchant: string;
  category: MarketCategory;
  /** Price in ZEC. */
  priceZec: number;
  blurb: string;
  /** How the rider receives it (no shipping address required). */
  fulfillment: string;
  /** Merchant's Unified Address — payment goes straight here. */
  merchantUA: string;
}

// Sample beta merchant address (the project treasury UA stands in until real
// merchants onboard with their own view-only shops). Clearly a placeholder.
const SAMPLE_MERCHANT_UA =
  'u19r0gg89utgp9kcqtdasfyfc6nds5sc6tgzny2sgvrsuyw3z97kkg45h87gufsamfhmyxfykg6amlk3lp0ynlc9wgxx60v9gdsuap0zk9';

export const CATALOG: MarketItem[] = [
  {
    id: 'tuneup-basic',
    title: 'Basic tune-up',
    merchant: 'Sample Bike Co.',
    category: 'service',
    priceZec: 0.03,
    blurb:
      'Brakes, gears, and drivetrain dialed in. Pay privately, redeem the code in-store.',
    fulfillment: 'Redeem code in-store · no shipping, no address',
    merchantUA: SAMPLE_MERCHANT_UA,
  },
  {
    id: 'coaching-month',
    title: '1-month coaching plan',
    merchant: 'Sample Coaching',
    category: 'digital',
    priceZec: 0.05,
    blurb:
      'A personalized training plan delivered to the app. No email, no data trail.',
    fulfillment: 'Delivered in-app',
    merchantUA: SAMPLE_MERCHANT_UA,
  },
  {
    id: 'giftcard-25',
    title: 'Gear gift card',
    merchant: 'Sample Gear',
    category: 'voucher',
    priceZec: 0.04,
    blurb:
      'A redeemable code toward parts and accessories. Spend your ride earnings on real kit.',
    fulfillment: 'Voucher code · redeem online or in-store',
    merchantUA: SAMPLE_MERCHANT_UA,
  },
  {
    id: 'routepack-local',
    title: 'Local route pack',
    merchant: 'Sample Routes',
    category: 'digital',
    priceZec: 0.008,
    blurb:
      'Curated rides for your area. Bought privately, opened on your device only.',
    fulfillment: 'Delivered in-app',
    merchantUA: SAMPLE_MERCHANT_UA,
  },
];

export function categoryLabel(c: MarketCategory): string {
  return c === 'service' ? 'SERVICE' : c === 'digital' ? 'DIGITAL' : 'VOUCHER';
}
