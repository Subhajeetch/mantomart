"use client"

import * as React from "react"
import { ChevronsUpDown, Sun, MoonStar } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
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
  ToggleGroupItem 
} from "@/components/ui/toggle-group"
import { Session } from "@repo/types/session-client";
import { useSession } from "@/lib/auth-client";

import Image from "next/image"


import config from "@/mine.config"

export function NavHeader() {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  const { data } = useSession();
  const session = data as Session | null;

  

  function finalRole() {
    if (!session) {
      return "?";
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
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg outline-2 text-sidebar-primary-foreground overflow-hidden">
                <Image src={config.logoShort} alt={config.brandName + "'s logo"} width={30} height={30} className="h-9 w-9 object-contain" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold">{config.brandName}</span>
                <span className="truncate text-xs uppercase">{finalRole() || "?"}</span>
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
                  <ToggleGroupItem value="dark" aria-label="Toggle dark theme" className="flex-1">
                    <MoonStar />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="light" aria-label="Toggle light theme" className="flex-1">
                    <Sun />
                  </ToggleGroupItem>
               </ToggleGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
