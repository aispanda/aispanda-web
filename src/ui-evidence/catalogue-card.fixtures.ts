import type { CatalogueAsset } from '@/data/site';

const proof = (lastVerified: string, note: string): CatalogueAsset['proof'] => ({
  lastVerified,
  note,
  links: [
    { label: 'Read record', href: '/records/example' },
    { label: 'View evidence', href: '/evidence/example' },
  ],
});

export const populatedAsset: CatalogueAsset = {
  id: 'example-reusable-method',
  name: 'Example reusable method',
  type: 'Delivery method',
  status: 'Reusable',
  summary: 'A fictional reusable method with stable, synthetic inputs for interface verification.',
  outcome: 'Shows how a clear record can communicate purpose, maturity, evidence, and safe next actions.',
  href: '/records/example',
  tags: ['Interface', 'Evidence', 'Quality'],
  proof: proof('2026-08-18', 'Synthetic evidence summary for a deterministic local fixture.'),
};

export const featuredAsset: CatalogueAsset = {
  ...populatedAsset,
  id: 'example-featured-method',
  name: 'Example featured method',
  status: 'Pilot-ready',
  summary: 'A fictional highlighted state used to check emphasis without changing the card’s information hierarchy.',
  outcome: 'Checks that a promoted item remains understandable and retains the same proof and action pattern.',
  proof: proof('2026-08-17', 'Synthetic pilot evidence with an explicit evaluation boundary.'),
};

export const draftAsset: CatalogueAsset = {
  ...populatedAsset,
  id: 'example-draft-method',
  name: 'Example draft method',
  status: 'Draft',
  summary: 'A fictional early state that makes incomplete maturity visible without concealing the next action.',
  outcome: 'Checks that status distinctions are communicated through text and structure as well as visual treatment.',
  proof: proof('2026-08-16', 'No external release claim; fixture exists only for local interface review.'),
};
