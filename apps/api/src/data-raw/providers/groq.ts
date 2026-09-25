import type { AiProviderConfig } from './types';

export const GROQ_PROVIDER = {
  id: 'groq',
  label: 'Groq',
  shortLabel: 'Groq',
  models: [
    {
      id: 'groq:qwen/qwen3.8-27b',
      label: 'Qwen 3.8 27B',
      description: 'Fast model, understands images too.',
      tier: 'recommended',
      recommended: true,
    },
  ],
} satisfies AiProviderConfig;