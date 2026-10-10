import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}
