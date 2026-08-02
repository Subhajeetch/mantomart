"use client"

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  LogOut,
  Settings,
  CircleArrowOutUpRight
} from "lucide-react"

import Image from "next/image"
import Link from "next/link"
import config from "@/mine.config"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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

import { authClient } from "@/lib/auth-client";
import { getStoreLoginUrl, getAdminOverviewUrl } from "@/lib/app-urls";

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile, setOpenMobile } = useSidebar()

  // Generate initials from name
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  function closeMobileSidebar() {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  function handleSignOut() {
    closeMobileSidebar()
    void authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Cross-origin hard nav to store login (admin has no /login UI).
          window.location.assign(
            getStoreLoginUrl(getAdminOverviewUrl()),
          );
        },
        onError: () => {
          // Still leave the admin app even if the API call fails.
          window.location.assign(
            getStoreLoginUrl(getAdminOverviewUrl()),
          );
        },
      },
    });
  }

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
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            // Keep focus on the trigger so the Sheet does not steal it on close
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-bold">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  href={config.storeFrontURI}
                  className="flex w-full items-center"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMobileSidebar}
                >
                  <div className="flex gap-2 items-center mr-auto">
                    <Image
                        src="/logos/mantomart-logo-short.png"
                        alt="Search Icon"
                        width={16}
                        height={16}
                      />
                    Storefront
                  </div>
                  <CircleArrowOutUpRight />
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={closeMobileSidebar}>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={closeMobileSidebar}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={closeMobileSidebar}>
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
