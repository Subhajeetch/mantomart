import type { AiProviderConfig } from './types';

export const GEMINI_PROVIDER = {
  id: 'gemini',
  label: 'Google Gemini',
  shortLabel: 'Gemini',
  models: [
    {
      id: 'gemini-3.6-flash',
      label: 'Gemini 3.6 Flash',
      description: 'Balanced quality and speed for product SEO.',
      tier: 'recommended',
      recommended: true,
    },
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Proven workhorse for fast, reliable copy.',
      tier: 'balanced',
    },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash-Lite',
      description: 'Fast, lower-cost model for high-volume generation.',
      tier: 'fast',
    },
  ],
} satisfies AiProviderConfig;
