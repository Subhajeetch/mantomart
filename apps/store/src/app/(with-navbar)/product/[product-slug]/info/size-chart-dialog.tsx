'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type SizeChartDialogProps = {
  productName: string;
  image: string | null;
  description: string | null;
};

export function SizeChartDialog({
  productName,
  image,
  description,
}: SizeChartDialogProps) {
  if (!image && !description) return null;

  return (
    <Dialog>
      <DialogTrigger className="text-sm text-foreground/70 underline underline-offset-4 hover:text-foreground">
        Size chart
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Size chart</DialogTitle>
          <DialogDescription>
            Sizing guide for {productName}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
            <img
              src={image}
              alt={`${productName} size chart`}
              className="w-full object-contain"
            />
          ) : null}
          {description ? (
            <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {description}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
