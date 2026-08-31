"use client"
import Link from "next/link";
import { ChevronLeft, RefreshCcw  } from 'lucide-react';
import { Button } from "@/components/ui/button";

const handleRefresh = () => {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
};

const Page = () => {
  return (
    <main>
    <div className="w-full h-screen flex items-center justify-center lg:gap-12 flex-col lg:flex-row">
      <div className="flex flex-col text-center lg:text-left items-center lg:items-start">
        <h1 className="text-4xl font-bold">Something went wrong</h1>
        <p className="text-lg text-muted-foreground">
          You can try refreshing the page, or go back to the home page.
        </p>


        <div className="flex mt-6 flex-col lg:flex-row gap-4">
        <Button
          onClick={handleRefresh}
          size="lg"
          variant="outline"
        >
          <RefreshCcw  />
          Refresh
        </Button>

        <Link 
            href="/overview"
            >
              <Button
          onClick={handleRefresh}
          size="lg"
          variant="outline"
        >
          <ChevronLeft size={18} />
            Go Home
        </Button>
            
        </Link>
        </div>


      </div>
    </div>
    </main>
  );
}

export default Page;