"use client"

import * as React from "react"
import {
  Frame,
  ScrollText,
  Package,
  ShoppingCart,
  User,
  Star,
  Cable,
  Store,
  FolderTree,
  type LucideIcon,
  ChartColumn,
} from "lucide-react"

import type { Session } from "@repo/types/session-client";
import { useSession } from "@/lib/auth-client";

import { NavUser } from "@/components/nav-user"
import { NavHeader } from "@/components/nav-header"
import { SidebarLinks } from "@/components/sidebar-links"
import { SidebarTodoProgress } from "@/components/todo-progress"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"


const sidebarLinks: {
  title: string;
  type: "link" | "dropdown";
  url?: string;
  icon: LucideIcon;
  isActive?: boolean;
  items?: {
    title: string;
    url: string;
  }[];
}[] = [
  {
    title: "Overview",
    type: "link",
    url: "/overview",
    icon: Frame,
  },
  {
    title: "Order Management",
    type: "link",
    url: "/manage/orders",
    icon: Package,
  },
  {
    title: "Category Management",
    type: "link",
    url: "/manage/categories",
    icon: FolderTree,
  },
  {
    title: "Admin Stats",
    type: "link",
    url: "/stats",
    icon: ChartColumn,
  },
  {
    title: "Products",
    type: "dropdown",
    icon: ShoppingCart,
    isActive: true,
    items: [
      {
        title: "Manage Products",
        url: "/product/manage",
      },
      {
        title: "Add Product",
        url: "/product/add",
      }
    ]
  },
  {
    title: "Users",
    type: "dropdown",
    icon: User,
    items: [
      {
        title: "Manage Users",
        url: "/manage/users",
      },
      {
        title: "Manage Admins",
        url: "/manage/admins",
      }
    ]
  },
  {
    title: "Manage Store",
    type: "dropdown",
    icon: Store,
    items: [
      {
        title: "Manage Header",
        url: "/store/edit/header",
      },
      {
        title: "Manage Homepage",
        url: "/store/edit/homepage",
      }
    ]
  },
  {
    title: "Reviews",
    type: "link",
    url: "#",
    icon: Star,
  },
  {
    title: "Audit Logs",
    type: "link",
    url: "/audit-logs",
    icon: ScrollText,
  },
  {
    title: "Connections",
    type: "link",
    url: "/connections",
    icon: Cable,
  }
]
 


/**
 * Auth redirects live in AdminAuthGate (layout). This sidebar only renders
 * when a staff session is already confirmed.
 */
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data, isPending } = useSession();
  const session = data as Session | null;

  if (isPending || !session?.session) {
    return (
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <NavHeader />
        </SidebarHeader>
        <SidebarContent>
          <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
            Loading…
          </div>
        </SidebarContent>
      </Sidebar>
    );
  }

  const finalUser = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? "/avatars/default.jpg",
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavHeader />
      </SidebarHeader>
      <SidebarContent>
        <SidebarTodoProgress />
        <SidebarLinks items={sidebarLinks} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={finalUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
