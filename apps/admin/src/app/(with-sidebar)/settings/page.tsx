'use client';

import { useMemo } from 'react';
import { Image as ImageIcon, RotateCcw, Settings2 } from 'lucide-react';
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import {
  SETTING_CATEGORIES,
  SETTINGS,
  getSettingsByCategory,
  resetAllSettings,
  type SettingDefinition,
} from './settings';
import { useSettings } from './use-settings';

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

export default function SettingsPage() {
  const { values, setValue, hydrated } = useSettings();

  const categoriesWithSettings = useMemo(() => {
    return SETTING_CATEGORIES.map((category) => ({
      ...category,
      settings: getSettingsByCategory(category.id),
    })).filter((c) => c.settings.length > 0);
  }, []);

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
    toast.success('Settings reset', {
      description: 'All options restored to defaults.',
    });
  };

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
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
            Reset
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pb-10 pt-0 md:px-6">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Preferences are stored in this browser only.
          </p>
        </div>

        <div className="w-full space-y-6">
          {categoriesWithSettings.map((category) => (
            <Card key={category.id} className="w-full p-0 py-4">
              <CardContent className="space-y-3">
                {category.settings.map((setting) => (
                  <SettingRow
                    key={setting.id}
                    setting={setting}
                    value={Boolean(values[setting.id])}
                    disabled={!hydrated}
                    onChange={(next) => handleChange(setting.id, next)}
                  />
                ))}
              </CardContent>
            </Card>
          ))}

          {SETTINGS.length === 0 ? (
            <Card className="w-full">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Settings2 className="size-10 text-muted-foreground/40" />
                <p className="text-sm font-medium">No settings yet</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
