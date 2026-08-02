import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

/**
 * Authenticated admin shell.
 * Access control is enforced in `src/middleware.ts` BEFORE this layout
 * renders — no client-side gate, no flash of admin UI for non-staff.
 */
export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}