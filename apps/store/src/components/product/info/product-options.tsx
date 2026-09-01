'use client';

import { cn } from '@/lib/utils';

import type { PublicOptionGroup } from '../types';
import type { ProductSelection } from '../use-product-selection';
import { SizeChartDialog } from './size-chart-dialog';

type ProductOptionsProps = {
  groups: PublicOptionGroup[];
  selection: ProductSelection;
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  productName: string;
};

export function ProductOptions({
  groups,
  selection,
  hasSizeChart,
  sizeChartImage,
  sizeChartDescription,
  productName,
}: ProductOptionsProps) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const selectedValue = selection.selected[group.name];
        const isSizeLike = /size/i.test(group.name);
        return (
          <fieldset key={group.name} className="min-w-0">
            <legend className="mb-2 flex w-full items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium text-foreground">{group.name}:</span>{' '}
                <span className="text-foreground/70">
                  {selectedValue || 'Select'}
                </span>
              </span>
              {isSizeLike && hasSizeChart ? (
                <SizeChartDialog
                  productName={productName}
                  image={sizeChartImage}
                  description={sizeChartDescription}
                />
              ) : null}
            </legend>
            {group.hasImages ? (
              <div className="flex flex-wrap gap-2">
                {group.values.map((option) => {
                  const selected = selectedValue === option.value;
                  const available = selection.isOptionAvailable(
                    group.name,
                    option.value
                  );
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        selection.selectOption(group.name, option.value)
                      }
                      disabled={!available && !selected}
                      aria-pressed={selected}
                      aria-label={option.value}
                      className={cn(
                        'relative size-16 overflow-hidden bg-neutral-100 ring-1 ring-border',
                        selected && 'ring-2 ring-foreground',
                        !available && 'opacity-40'
                      )}
                    >
                      {option.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
                        <img
                          src={option.image}
                          alt=""
                          className="size-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center px-1 text-center text-[10px] leading-tight">
                          {option.value}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {group.values.map((option) => {
                  const selected = selectedValue === option.value;
                  const available = selection.isOptionAvailable(
                    group.name,
                    option.value
                  );
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        selection.selectOption(group.name, option.value)
                      }
                      disabled={!available && !selected}
                      aria-pressed={selected}
                      className={cn(
                        'min-w-11 px-3 py-2 text-sm font-medium ring-1 ring-border',
                        selected
                          ? 'bg-foreground text-background ring-foreground'
                          : 'bg-background hover:bg-muted',
                        !available && 'opacity-40 line-through'
                      )}
                    >
                      {option.value}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}
      {hasSizeChart && !groups.some((group) => /size/i.test(group.name)) ? (
        <SizeChartDialog
          productName={productName}
          image={sizeChartImage}
          description={sizeChartDescription}
        />
      ) : null}
    </div>
  );
}
