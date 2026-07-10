import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export const ManageAdmins = () => {
  return (
    <>
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4 ">
        <SidebarTrigger className="-ml-1" />
        <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
        />
        <Breadcrumb>
            <BreadcrumbList>
            <BreadcrumbItem>
                <BreadcrumbPage>Manage Admins</BreadcrumbPage>
            </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
        </div>
    </header>
    
    <main className="p-4">
        <h1>Manage Admins</h1>
    </main>
       </>
  );
};

export default ManageAdmins;