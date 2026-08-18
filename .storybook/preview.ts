import type { Preview } from '@storybook-astro/framework';
import '../src/styles/global.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: {
      default: 'canvas',
      values: [
        { name: 'canvas', value: '#f3f1ea' },
        { name: 'surface', value: '#ffffff' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
