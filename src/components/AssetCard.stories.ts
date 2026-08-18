import AssetCard from './AssetCard.astro';
import { draftAsset, featuredAsset, populatedAsset } from '@/ui-evidence/catalogue-card.fixtures';

export default {
  title: 'Components/Catalogue Card',
  component: AssetCard,
  parameters: {
    docs: {
      description: {
        component:
          'A real production catalogue card rendered with synthetic fixtures. These stories verify the declared component states only; they do not establish live-data, authorization, privacy, security, or release behavior.',
      },
    },
  },
};

export const Populated = {
  args: {
    asset: populatedAsset,
    featured: false,
  },
};

export const Featured = {
  args: {
    asset: featuredAsset,
    featured: true,
  },
};

export const Draft = {
  args: {
    asset: draftAsset,
    featured: false,
  },
};
