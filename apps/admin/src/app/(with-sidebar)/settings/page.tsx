'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Laptop,
  MoonStar,
  RotateCcw,
  Settings2,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import {
  SETTINGS,
  resetAllSettings,
  type SettingDefinition,
} from './settings';
import { useSettings } from './use-settings';

/** Matches ThemeProvider defaultTheme. */
const DEFAULT_THEME = 'dark' as const;

type ThemeValue = 'light' | 'dark' | 'system';

const THEME_OPTIONS: Array<{
  value: ThemeValue;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright background, dark text',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Dim background, light text',
    icon: MoonStar,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Match your device preference',
    icon: Laptop,
  },
];

function isThemeValue(value: string | undefined): value is ThemeValue {
  return value === 'light' || value === 'dark' || value === 'system';
}

function themeLabel(value: string | undefined): string {
  if (!isThemeValue(value)) return 'Theme';
  return THEME_OPTIONS.find((o) => o.value === value)?.label ?? 'Theme';
}

function ThemeIcon({
  value,
  className,
}: {
  value: string | undefined;
  className?: string;
}) {
  if (value === 'light') return <Sun className={className} />;
  if (value === 'system') return <Laptop className={className} />;
  return <MoonStar className={className} />;
}

function SettingIcon({ id }: { id: string }) {
  if (id === 'image-proxy') {
    return <ImageIcon className="size-4 text-primary" />;
  }
  return <Settings2 className="size-4 text-muted-foreground" />;
}

function SettingRow({
  setting,
  value,
  onChange,
  disabled,
}: {
  setting: SettingDefinition;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const switchId = `setting-${setting.id}`;

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-colors',
        'hover:bg-muted/40',
        value && 'border-primary/20 bg-primary/[0.03]'
      )}
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border',
          value
            ? 'border-primary/30 bg-primary/10'
            : 'border-border bg-muted/60'
        )}
      >
        <SettingIcon id={setting.id} />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor={switchId}
            className="cursor-pointer text-sm font-medium leading-none"
          >
            {setting.name}
          </Label>
          {setting.badge ? (
            <Badge variant="secondary" className="text-[10px] font-medium">
              {setting.badge}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{setting.description}</p>
      </div>

      <Switch
        id={switchId}
        checked={value}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={setting.name}
      />
    </div>
  );
}

function ThemeSettingRow() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = isThemeValue(theme) ? theme : DEFAULT_THEME;
  const CurrentIcon =
    THEME_OPTIONS.find((o) => o.value === current)?.icon ?? MoonStar;

  function handleThemeChange(next: string) {
    if (!isThemeValue(next) || next === theme) return;
    setTheme(next);
    const option = THEME_OPTIONS.find((o) => o.value === next);
    toast.success(`Theme set to ${option?.label ?? next}`, {
      description:
        next === 'system'
          ? 'Follows your device appearance.'
          : 'Saved in this browser.',
    });
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-colors',
        'hover:bg-muted/40',
        'border-primary/20 bg-primary/[0.03]'
      )}
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border',
          'border-primary/30 bg-primary/10'
        )}
      >
        {mounted ? (
          <CurrentIcon className="size-4 text-primary" />
        ) : (
          <Skeleton className="size-4 rounded-sm" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium leading-none">Theme</p>
          {mounted && current === 'system' && resolvedTheme ? (
            <Badge
              variant="secondary"
              className="text-[10px] font-medium capitalize"
            >
              Using {resolvedTheme}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Choose light, dark, or match your system.
        </p>
      </div>

      {!mounted ? (
        <Skeleton className="h-9 w-[8.5rem] rounded-lg" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-9 min-w-[8.5rem] justify-between gap-2 px-3 font-medium',
                'bg-background shadow-none'
              )}
              aria-label={`Theme: ${themeLabel(current)}. Change theme`}
            >
              <span className="flex items-center gap-2">
                <ThemeIcon
                  value={current}
                  className="size-3.5 text-muted-foreground"
                />
                {themeLabel(current)}
              </span>
              <ChevronDown className="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-62" sideOffset={6}>
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={current}
              onValueChange={handleThemeChange}
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = current === option.value;
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="cursor-pointer py-2 pr-8 pl-2"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <div
                        className={cn(
                          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
                          selected
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border bg-muted/50 text-muted-foreground'
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm leading-none font-medium">
                            {option.label}
                          </span>
                          {selected ? (
                            <Check className="text-primary size-3 sm:hidden" />
                          ) : null}
                        </div>
                        <p className="text-muted-foreground text-xs leading-snug">
                          {option.description}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { values, setValue, hydrated } = useSettings();
  const { setTheme } = useTheme();

  const handleChange = (id: string, next: boolean) => {
    setValue(id, next);
    const def = SETTINGS.find((s) => s.id === id);
    toast.success(
      next
        ? `${def?.name ?? 'Setting'} enabled`
        : `${def?.name ?? 'Setting'} disabled`,
      { description: 'Saved in this browser.' }
    );
  };

  const handleReset = () => {
    resetAllSettings();
    setTheme(DEFAULT_THEME);
    toast.success('Settings reset', {
      description: 'All options restored to defaults.',
    });
  };

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]:sidebar-wrapper:h-12">
        <div className="flex w-full items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Settings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={handleReset}
            disabled={!hydrated}
          >
            <RotateCcw className="size-3.5" />
            Reset Settings
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pt-0 pb-10 md:px-6">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-muted-foreground text-sm">
            Preferences are stored in this browser only.
          </p>
        </div>

        {/* Flat list — no category cards */}
        <div className="w-full max-w-2xl space-y-3">
          <ThemeSettingRow />
          {SETTINGS.map((setting) => (
            <SettingRow
              key={setting.id}
              setting={setting}
              value={Boolean(values[setting.id])}
              disabled={!hydrated}
              onChange={(next) => handleChange(setting.id, next)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
