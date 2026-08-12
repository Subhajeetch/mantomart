"use client"

import * as React from "react"
import { ChevronsUpDown, Sun, MoonStar } from "lucide-react"
import { useTheme } from "next-themes"
import Image from "next/image"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Session } from "@repo/types/session-client"
import { useSession } from "@/lib/auth-client"
import {
  IMAGE_PROXY_SETTING_ID,
} from "@/app/(with-sidebar)/settings/settings"
import { useSetting } from "@/app/(with-sidebar)/settings/use-settings"
import config from "@/mine.config"

const IMG_PROXY_SWITCH_ID = "quick-setting-image-proxy"

export function NavHeader() {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  const { data } = useSession()
  const session = data as Session | null

  const {
    value: imageProxyEnabled,
    setValue: setImageProxyEnabled,
    hydrated: imageProxyHydrated,
  } = useSetting(IMAGE_PROXY_SETTING_ID)

  function finalRole() {
    if (!session) {
      return "?"
    }
    return session.user.role
  }

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/*
          modal={false}: mobile sidebar is a Sheet (Dialog). A nested modal
          DropdownMenu fights the Sheet for focus/pointer events on touch.
        */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg outline-2 text-sidebar-primary-foreground">
                <Image
                  src={config.logoShort}
                  alt={config.brandName + "'s logo"}
                  width={30}
                  height={30}
                  className="h-9 w-9 object-contain"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold">{config.brandName}</span>
                <span className="truncate text-xs uppercase">
                  {finalRole() || "?"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            // Keep focus on the trigger so the Sheet does not steal it on close
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Quick settings
            </DropdownMenuLabel>

            {mounted && (
              <ToggleGroup
                type="single"
                size="sm"
                // ToggleGroup is single-select; ignore empty value (re-click deselect).
                value={theme === "light" || theme === "dark" ? theme : "dark"}
                onValueChange={(value) => {
                  if (value === "light" || value === "dark") setTheme(value)
                }}
                variant="outline"
                className="my-2 flex w-full items-center justify-center rounded-md bg-popover p-1"
                spacing={2}
              >
                <ToggleGroupItem
                  value="dark"
                  aria-label="Toggle dark theme"
                  className="flex-1"
                >
                  <MoonStar />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="light"
                  aria-label="Toggle light theme"
                  className="flex-1"
                >
                  <Sun />
                </ToggleGroupItem>
              </ToggleGroup>
            )}


            {/*
              Not a DropdownMenuItem — keeps the menu open while toggling,
              and avoids Radix treating the switch as a select-and-close action.
            */}
            <div
              className="flex items-center justify-between gap-3 rounded-md px-1.5 py-2"
              // Stop pointer events from bubbling into menu select handlers
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Label
                htmlFor={IMG_PROXY_SWITCH_ID}
                className="cursor-pointer text-sm font-medium leading-none"
              >
                Image Proxy
              </Label>
              <Switch
                id={IMG_PROXY_SWITCH_ID}
                size="sm"
                checked={imageProxyHydrated ? imageProxyEnabled : false}
                disabled={!imageProxyHydrated}
                onCheckedChange={setImageProxyEnabled}
                aria-label="Img Proxy"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
