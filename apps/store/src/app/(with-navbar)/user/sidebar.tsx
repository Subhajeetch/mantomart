"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronRight,
  ExternalLink,
  Heart,
  LayoutDashboard,
  LogOut,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import type { Session } from "@repo/types/session-client";
import { canAccessAdminPanel, getAdminOverviewUrl } from "@/lib/app-urls";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const groups = [
  {
    label: "Account",
    items: [
      { href: "/user/profile", label: "Profile", icon: UserRound },
      { href: "/user/sessions", label: "Manage Sessions", icon: ShieldCheck },
    ],
  },
  {
    label: "Shopping",
    items: [
      { href: "/user/orders", label: "Orders", icon: ShoppingBag },
      { href: "/user/wishlists", label: "Wishlists", icon: Heart },
      { href: "/user/addresses", label: "Saved Addresses", icon: MapPin },
    ],
  },
  {
    label: "Preferences",
    items: [
      { href: "/user/notifications", label: "Notifications", icon: Bell },
    ],
  },
] as const;

function initials(name: string | null | undefined, email: string) {
  return name
    ? name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : email.slice(0, 2).toUpperCase();
}

export function UserSidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const { user } = session;

  return (
    <aside className="w-full shrink-0 border-border bg-background lg:sticky lg:top-16 lg:h-[calc(100svh-4rem)] lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div className="border-b border-border p-5">
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="rounded-none after:rounded-none inline-flex lg:hidden">
            <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} className="rounded-none" />
            <AvatarFallback className="rounded-none bg-muted text-sm font-semibold">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name || "Your account"}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </div>

      {canAccessAdminPanel(user.role) && (
        <a
          href={getAdminOverviewUrl()}
          className="mx-4 mt-4 flex items-center justify-between border border-primary/40 bg-primary/10 px-3 py-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
        >
          <span className="flex items-center gap-2">
            <LayoutDashboard className="size-4" />
            Admin Panel
          </span>
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <nav className="space-y-5 p-4" aria-label="Account navigation">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active =
                          item.href === "/user/profile"
                            ? pathname === "/user/profile"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center justify-between border-l-2 border-transparent px-2 py-2.5 text-sm text-muted-foreground transition-all duration-200 hover:border-foreground/40 hover:bg-muted hover:text-foreground",
                      active && "border-foreground bg-muted text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="size-4" strokeWidth={active ? 2.25 : 1.8} />
                      {item.label}
                    </span>
                    <ChevronRight className="size-4 opacity-60 transition-transform group-hover:translate-x-0.5 lg:hidden" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <LogoutButton />
    </aside>
  );
}

function LogoutButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.assign("/login");
        },
      },
    });
    setBusy(false);
  }

  return (
    <>
      <div className="border-t border-border p-4">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
          <LogOut className="size-4" />
          Log out
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out of your account?</DialogTitle>
            <DialogDescription>You will need to sign in again to access your account.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={logout} disabled={busy}>{busy ? "Logging out..." : "Log out"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
