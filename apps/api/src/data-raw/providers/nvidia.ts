import type { AiProviderConfig } from './types';

export const NVIDIA_PROVIDER = {
  id: 'nvidia',
  label: 'NVIDIA NIM',
  shortLabel: 'NVIDIA',
  models: [
    {
      id: 'nvidia:deepseek-ai/deepseek-v4.1-flash',
      label: 'DeepSeek V4.1 Flash',
      description: 'Fast and very effective model',
      tier: 'recommended',
      recommended: true,
    },
    {
      id: 'nvidia:z-ai/glm-5.3',
      label: 'GLM 5.3',
      description: 'High-quality reasoning and writing model.',
      tier: 'balanced',
    },
    {
      id: 'nvidia:z-ai/glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      description: 'High-quality (Fast) reasoning and writing model.',
      tier: 'balanced',
    },
    {
      id: 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
      label: 'Nemotron 3.5 Lightning 30B A3B',
      description: 'High-quality reasoning and writing model.',
      tier: 'balanced',
    },
    {
      id: 'nvidia:nvidia/nemotron-3-ultra-550b-a55b',
      label: 'Nemotron 3 Ultra 550B A55B',
      description: 'High-quality reasoning and writing model.',
      tier: 'balanced',
    },
    {
      id: 'nvidia:meta/muse-glimmer-30b',
      label: 'Muse Glimmer 30B',
      description: 'High-quality reasoning and writing model.',
      tier: 'balanced',
    },
  ],
} satisfies AiProviderConfig;
