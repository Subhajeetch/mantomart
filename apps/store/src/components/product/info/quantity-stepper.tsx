'use client';

import { Minus, Plus } from 'lucide-react';

type QuantityStepperProps = {
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
};

export function QuantityStepper({
  value,
  max,
  disabled = false,
  onChange,
}: QuantityStepperProps) {
  const cap = Math.max(1, max);

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Quantity</p>
      <div className="inline-flex items-center ring-1 ring-border">
        <button
          type="button"
          aria-label="Decrease quantity"
          disabled={disabled || value <= 1}
          onClick={() => onChange(value - 1)}
          className="flex size-10 items-center justify-center disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-10 text-center text-sm font-medium tabular-nums">
          {value}
        </span>
        <button
          type="button"
          aria-label="Increase quantity"
          disabled={disabled || value >= cap}
          onClick={() => onChange(value + 1)}
          className="flex size-10 items-center justify-center disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
