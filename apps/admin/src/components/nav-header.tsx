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


import config from "@/mine.config"

export function NavHeader() {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg outline-2 text-sidebar-primary-foreground">
                <img src={config.logoShort} alt={config.brandName + "'s logo"} className="h-7 w-7" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{config.brandName}</span>
                <span className="truncate text-xs">Admin</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Quick settings
            </DropdownMenuLabel>

            {mounted && (
              <ToggleGroup
                  type="single"
                  size="sm"
                  value={theme}
                  onValueChange={setTheme}
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
