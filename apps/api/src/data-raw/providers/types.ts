export type AiProviderId =
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'nvidia';

export type AiModelTier =
  | 'recommended'
  | 'balanced'
  | 'fast'
  | 'premium'
  | 'preview';

export type AiModelConfig = {
  id: string;
  label: string;
  description: string;
  tier: AiModelTier;
  recommended?: boolean;
};

export type AiProviderConfig = {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  models: readonly AiModelConfig[];
};
