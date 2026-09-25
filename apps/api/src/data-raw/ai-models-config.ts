import { GEMINI_PROVIDER } from './providers/gemini';
import { GROQ_PROVIDER } from './providers/groq';
import { MISTRAL_PROVIDER } from './providers/mistral';
import { NVIDIA_PROVIDER } from './providers/nvidia';
import { OPENROUTER_PROVIDER } from './providers/openrouter';
import type {
  AiModelConfig,
  AiModelTier,
  AiProviderConfig,
  AiProviderId,
} from './providers/types';

export type {
  AiModelConfig,
  AiModelTier,
  AiProviderConfig,
  AiProviderId,
} from './providers/types';

/**
 * Provider files contain the model lists. Keep this array in the desired UI
 * order; add a provider here after creating its file in ./providers.
 */
export const AI_PROVIDERS: readonly AiProviderConfig[] = [
  GROQ_PROVIDER,
  MISTRAL_PROVIDER,
  OPENROUTER_PROVIDER,
  GEMINI_PROVIDER,
  NVIDIA_PROVIDER,
];

export const AI_DEFAULT_MODEL = 'groq:qwen/qwen3.8-27b';

const MODEL_LOOKUP = new Map<
  string,
  { provider: AiProviderId; model: AiModelConfig }
>(
  AI_PROVIDERS.flatMap((provider) =>
    provider.models.map((model) => [
      model.id,
      { provider: provider.id, model },
    ] as const)
  )
);

export function getAiModelConfig(modelId: string) {
  return MODEL_LOOKUP.get(modelId);
}

export function getAiProviderConfig(providerId: AiProviderId) {
  return AI_PROVIDERS.find((provider) => provider.id === providerId);
}
