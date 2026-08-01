import { AdminAuthGate } from "@/components/admin-auth-gate"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
  return (
    <AdminAuthGate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </AdminAuthGate>
  )
}