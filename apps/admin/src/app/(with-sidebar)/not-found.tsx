import Link from "next/link";
import { ChevronLeft } from 'lucide-react';

const Page = () => {
  return (
    <main>
    <div className="w-full h-screen flex items-center justify-center lg:gap-12 flex-col lg:flex-row">
      <div className="flex flex-col text-center lg:text-left items-center lg:items-start">
        <h1 className="text-4xl font-bold">404 - Not Found</h1>
        <p className="text-lg text-muted-foreground">
          The page you&apos;re looking for does not exist.
        </p>


        <Link 
            href="/overview"
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-primary/50 bg-primary/10 text-foreground rounded-md hover:bg-primary/30 transition-colors w-fit">
            <ChevronLeft size={18} />
            Go Home
        </Link>
      </div>
    </div>
    </main>
  );
}

export default Page;