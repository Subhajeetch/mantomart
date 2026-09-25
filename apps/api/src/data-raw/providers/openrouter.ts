import type { AiProviderConfig } from './types';

export const OPENROUTER_PROVIDER = {
  id: 'openrouter',
  label: 'OpenRouter',
  shortLabel: 'OpenRouter',
  models: [
    {
      id: 'openrouter:qwen/qwen3.8-27b:free',
      label: 'Qwen 3.8 27B',
      description: 'Fast, free model that understands images.',
      tier: 'recommended',
      recommended: true,
    },
    {
      id: 'openrouter:nex-agi/nex-n2.5-pro:free',
      label: 'Nex N2.5 Pro',
      description: 'Free agentic model with vision support.',
      tier: 'balanced',
    },
    {
      id: 'openrouter:nex-agi/nex-n2.5-mini:free',
      label: 'Nex N2.5 Mini',
      description: 'Smaller, free, understands images too.',
      tier: 'fast',
    },
    {
      id: 'openrouter:dots-studio/dots-3-note-preview:free',
      label: 'Dots3-Note Preview',
      description: 'Free open-weight model with vision input.',
      tier: 'fast',
    },
  ],
} satisfies AiProviderConfig;