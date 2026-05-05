import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Image from "next/image";
import { LayoutGrid } from 'lucide-react';

import SearchProduct from "./search-product";
import MyList from "./my-list";

export default function Page() {
    
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
                  <BreadcrumbPage>Product Add</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

       <main className="px-4">
        <Tabs defaultValue="search-product" className="w-full flex">
          <TabsList className="w-full bg-background my-2 gap-3">
            <TabsTrigger value="search-product" className="flex-1 h-12 data-[state=active]:bg-muted/80! bg-muted/50 font-semibold">
            <Image src="/icons/aliexpress_logo.webp" alt="Search Icon" width={16} height={16} />
              Search Product
            </TabsTrigger>
            <TabsTrigger value="my-list" className="flex-1 h-12 data-[state=active]:bg-muted/80! bg-muted/50 font-semibold">
              <LayoutGrid size={18} />
              My List
            </TabsTrigger>
          </TabsList>
          <TabsContent value="search-product">
            <SearchProduct />
          </TabsContent>
          <TabsContent value="my-list">
            <MyList />
          </TabsContent>
        </Tabs>
       </main>
       </>
    )
}