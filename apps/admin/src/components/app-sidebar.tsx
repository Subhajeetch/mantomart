"use client"

import * as React from "react"
import {
  Frame,
  ScrollText,
  Package,
  ShoppingCart,
  User,
  Star,
  ShoppingBag,
  FolderTree,
  type LucideIcon,
} from "lucide-react"

import { Session } from "@repo/types/session-client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

import { NavUser } from "@/components/nav-user"
import { NavHeader } from "@/components/nav-header"
import { SidebarLinks } from "@/components/sidebar-links"
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
    title: "Integrations",
    type: "link",
    url: "/aliexpress-connect",
    icon: ShoppingBag,
  }
]
 


export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const router = useRouter();


    useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [session, isPending, router]);

    if (!session) {
      return null;
    }

    const finalUser = {
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.image ?? "/avatars/default.jpg",
    }

    //console.log(finalUser);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavHeader />
      </SidebarHeader>
      <SidebarContent>
        <SidebarLinks items={sidebarLinks} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={finalUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
