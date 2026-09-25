import type { AiProviderConfig } from './types';

export const MISTRAL_PROVIDER = {
  id: 'mistral',
  label: 'Mistral',
  shortLabel: 'Mistral',
  models: [
    {
      id: 'mistral:ministral-14b-2512',
      label: 'Ministral 3 14B',
      description: 'Compact, fast, understands images.',
      tier: 'recommended',
    },
    {
      id: 'mistral:ministral-8b-2512',
      label: 'Ministral 3 8B',
      description: 'Efficient model for routine product copy.',
      tier: 'fast',
    },
     {
      id: 'mistral:mistral-medium-latest',
      label: 'Mistral Medium 3.1',
      description: 'Balanced model with vision support.',
      tier: 'balanced',
    },
  ],
} satisfies AiProviderConfig;