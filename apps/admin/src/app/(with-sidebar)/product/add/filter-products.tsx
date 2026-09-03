'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDownUp,
  DollarSign,
  Filter,
  MessageCircle,
  ShoppingCart,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMediaQuery } from '@/hooks/use-media-query';

export type SearchExtendFilter = {
  min: string;
  max: string;
  searchKey: string;
  searchValue: string;
};

export type ProductSearchFilters = {
  local: string;
  countryCode: string;
  categoryId: string;
  sortBy: string;
  pageSize: string;
  currency: string;
  searchKey: string;
  searchValue: string;
  min: string;
  max: string;
  selectionName: string;
  searchExtend: SearchExtendFilter[];
};

export const DEFAULT_PRODUCT_SEARCH_FILTERS: ProductSearchFilters = {
  local: 'en_US',
  countryCode: 'US',
  categoryId: '',
  sortBy: '',
  pageSize: '30',
  currency: 'USD',
  searchKey: '',
  searchValue: '',
  min: '',
  max: '',
  selectionName: '',
  searchExtend: [],
};

const SHIP_TO_OPTIONS = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
] as const;

const SORT_OPTIONS = [
  { value: '', label: 'Relevance', icon: ArrowDownUp },
  { value: 'min_price,asc', label: 'Price: low to high', icon: DollarSign },
  { value: 'min_price,desc', label: 'Price: high to low', icon: DollarSign },
  { value: 'orders,desc', label: 'Most orders', icon: ShoppingCart },
  { value: 'orders,asc', label: 'Fewest orders', icon: ShoppingCart },
  { value: 'comments,desc', label: 'Most comments', icon: MessageCircle },
  { value: 'comments,asc', label: 'Fewest comments', icon: MessageCircle },
] as const;

type FilterProductsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ProductSearchFilters;
  onSave: (filters: ProductSearchFilters) => void;
};

function FilterForm({
  filters,
  onChange,
  onSave,
}: {
  filters: ProductSearchFilters;
  onChange: (filters: ProductSearchFilters) => void;
  onSave: () => void;
}) {
  const selectedShipTo =
    SHIP_TO_OPTIONS.find((option) => option.code === filters.countryCode) ??
    SHIP_TO_OPTIONS[0];

  const selectShipTo = (countryCode: string) => {
    onChange({
      ...DEFAULT_PRODUCT_SEARCH_FILTERS,
      countryCode,
      sortBy: filters.sortBy,
    });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4">
        <section className="space-y-2">
          <p className="text-sm font-medium">Ship To</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
              >
                <span>{selectedShipTo.label}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedShipTo.code}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Ship To</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={selectedShipTo.code}
                onValueChange={selectShipTo}
              >
                {SHIP_TO_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.code} value={option.code}>
                    {option.label} ({option.code})
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <section className="space-y-3">
          <div>
            <p className="text-sm font-medium">Sort By</p>
            <p className="text-xs text-muted-foreground">
              Choose how products should be ordered.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SORT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = filters.sortBy === option.value;

              return (
                <Button
                  key={option.value || 'relevance'}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({
                      ...filters,
                      sortBy: option.value,
                    })
                  }
                  className="h-auto min-h-12 justify-start gap-2 whitespace-normal px-3 py-2 text-left"
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="text-xs leading-4">{option.label}</span>
                </Button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="p-4">
        <Button type="submit" className="w-full h-12 text-[17px] font-semibold">
          <Search className="h-8 w-8" />
          Search
        </Button>
      </div>
    </form>
  );
}

export default function FilterProducts({
  open,
  onOpenChange,
  filters,
  onSave,
}: FilterProductsProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    if (open) {
      setDraft({
        ...DEFAULT_PRODUCT_SEARCH_FILTERS,
        countryCode: filters.countryCode || 'US',
        sortBy: filters.sortBy,
      });
    }
  }, [filters, open]);

  const form = (
    <FilterForm
      filters={draft}
      onChange={setDraft}
      onSave={() => {
        onSave({
          ...DEFAULT_PRODUCT_SEARCH_FILTERS,
          countryCode: draft.countryCode || 'US',
          sortBy: draft.sortBy,
        });
        onOpenChange(false);
      }}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle className="flex items-center gap-2">
              <Filter className="size-4" />
              Filter products
            </DialogTitle>
            <DialogDescription>
              Select a destination and sorting preference.
            </DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer showSwipeHandle={true} open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="text-left sr-only">
          <DrawerTitle className="flex items-center gap-2">
            <Filter className="size-4" />
            Filter products
          </DrawerTitle>
          <DrawerDescription>
            Select a destination and sorting preference.
          </DrawerDescription>
        </DrawerHeader>
        {form}
        <DrawerFooter />
      </DrawerContent>
    </Drawer>
  );
}
