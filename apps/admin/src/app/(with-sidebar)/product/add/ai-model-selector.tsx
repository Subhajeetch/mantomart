'use client';

import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { ChevronRightIcon } from 'lucide-react';
import {
  DeepSeek,
  DotsStudio,
  Google,
  Groq,
  Meta,
  Mistral,
  Nvidia,
  OpenAI,
  OpenRouter,
  Qwen,
  ZAI,
} from '@lobehub/icons';

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type AiModelOption = {
  id: string;
  label: string;
  description: string;
  tier: string;
  recommended?: boolean;
  providerId: string;
};

export type AiModelProvider = {
  id: string;
  label: string;
  shortLabel: string;
  configured: boolean;
  models: AiModelOption[];
};

type Props = {
  providers: AiModelProvider[];
  selectedModel: AiModelOption | null;
  selectedProvider: AiModelProvider | null;
  onSelect: (model: AiModelOption) => void;
  disabled?: boolean;
};

const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  gemini: Google.Color,
  openrouter: OpenRouter.Color,
  groq: Groq,
  mistral: Mistral.Color,
  nvidia: Nvidia.Color,
};

const MODEL_ICONS: Array<{
  matches: (model: AiModelOption) => boolean;
  render: (className?: string) => ReactNode;
}> = [
  {
    matches: (model) => /qwen/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <Qwen.Avatar size={20} shape="square" className={className} />
    ),
  },
  {
    matches: (model) => /openai|gpt(?:-|\s|$)/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <OpenAI.Avatar size={20} shape="square" className={className} />
    ),
  },
  {
    matches: (model) => /deepseek/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <DeepSeek.Avatar size={20} shape="square" className={className} />
    ),
  },
  {
    matches: (model) => /glm|z[-_.\s]?ai/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <ZAI.Avatar size={20} shape="square" className={className} />
    ),
  },
  {
    matches: (model) => /dots[-_.\s]?studio/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <DotsStudio.Avatar size={20} shape="square" className={className} />
    ),
  },
  {
    matches: (model) => /llama|meta/i.test(`${model.id} ${model.label}`),
    render: (className) => (
      <Meta.Avatar size={20} shape="square" className={className} />
    ),
  },
];

function ProviderIcon({
  providerId,
  className,
}: {
  providerId: string;
  className?: string;
}) {
  const Icon = PROVIDER_ICONS[providerId] ?? Google.Color;
  return <Icon className={cn('size-5 shrink-0', className)} />;
}

function ModelIcon({
  model,
  providerId,
  className,
}: {
  model: AiModelOption;
  providerId: string;
  className?: string;
}) {
  const match = MODEL_ICONS.find(({ matches }) => matches(model));
  if (match) {
    return match.render(cn('size-5 shrink-0', className));
  }
  return <ProviderIcon providerId={providerId} className={className} />;
}

export function AiModelSelector({
  providers,
  selectedModel,
  selectedProvider,
  onSelect,
  disabled,
}: Props) {
  const visibleProviders = providers.filter(
    (provider) => provider.models.length > 0
  );
  const fallbackProvider = visibleProviders[0] ?? null;
  const selectedVisibleProvider =
    visibleProviders.find((provider) => provider.id === selectedProvider?.id) ??
    fallbackProvider;
  const [open, setOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState(
    selectedVisibleProvider?.id ?? ''
  );

  useEffect(() => {
    setActiveProviderId(selectedVisibleProvider?.id ?? '');
  }, [selectedVisibleProvider?.id]);

  const activeProvider =
    visibleProviders.find((provider) => provider.id === activeProviderId) ??
    selectedVisibleProvider;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Item
          variant="outline"
          size="sm"
          className="cursor-pointer justify-between hover:bg-muted/50"
        >
          <ItemMedia>
            {selectedModel ? (
              <ModelIcon
                model={selectedModel}
                providerId={selectedVisibleProvider?.id ?? 'gemini'}
              />
            ) : (
              <ProviderIcon providerId={selectedVisibleProvider?.id ?? 'gemini'} />
            )}
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="truncate">
              {selectedModel?.label || 'Select an AI model'}
            </ItemTitle>
            <ItemDescription className="truncate">
              {selectedProvider?.label || 'Choose a provider'}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="z-[80] w-[min(30rem,calc(100vw-2rem))] p-3"
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('[role="listbox"]')) {
            event.preventDefault();
          }
        }}
      >
        {visibleProviders.length ? (
          <div className="space-y-3">
            <Select
              value={activeProvider?.id ?? ''}
              onValueChange={setActiveProviderId}
              disabled={disabled}
            >
              <SelectTrigger className="h-10 w-full gap-2">
                <SelectValue placeholder="Select a provider">
                  {activeProvider ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon
                        providerId={activeProvider.id}
                        className="size-4"
                      />
                      <span className="truncate">{activeProvider.label}</span>
                    </span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {visibleProviders.map((provider) => (
                  <SelectItem
                    key={provider.id}
                    value={provider.id}
                    className="gap-2 pl-8"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon
                        providerId={provider.id}
                        className="size-4"
                      />
                      <span className="truncate">{provider.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeProvider ? (
              <div className="grid max-h-[min(26rem,calc(100vh-12rem))] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {activeProvider.models.map((model) => {
                  const selected = selectedModel?.id === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50',
                        selected &&
                          'border-primary bg-primary/5 ring-1 ring-primary/20'
                      )}
                      onClick={() => {
                        setOpen(false);
                        onSelect(model);
                      }}
                    >
                      <ModelIcon
                        model={model}
                        providerId={activeProvider.id}
                        className="mt-0.5 size-5"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{model.label}</span>
                          {model.recommended ? (
                            <span className="shrink-0 text-[10px] text-primary">
                              Recommended
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                          {model.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No models are available for this provider.
              </p>
            )}
          </div>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            No AI models are available.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
