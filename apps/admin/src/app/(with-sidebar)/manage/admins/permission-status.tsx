'use client';

import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PermissionState } from './types';

export function PermissionStatus({ permission }: { permission: PermissionState }) {
  if (permission.override === true) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px]">
            Override: granted
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">Explicitly granted by an owner</TooltipContent>
      </Tooltip>
    );
  }

  if (permission.override === false) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px]">
            Override: denied
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">Explicitly denied by an owner</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="text-[10px]">
          Default: {permission.defaultGranted ? 'granted' : 'denied'}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Inherited from the {permission.defaultGranted ? 'admin' : 'customer'} role
      </TooltipContent>
    </Tooltip>
  );
}