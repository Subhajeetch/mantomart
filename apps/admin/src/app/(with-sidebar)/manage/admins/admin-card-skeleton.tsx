'use client';

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function AdminCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
      <CardFooter className="gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </CardFooter>
    </Card>
  );
}