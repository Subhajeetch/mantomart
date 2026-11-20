"use client"

import * as React from "react"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked"> {
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean | "indeterminate") => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, disabled, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null)

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    React.useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = checked === "indeterminate"
      }
    }, [checked])

    const isChecked = checked === true
    const isIndeterminate = checked === "indeterminate"

    return (
      <label
        className={cn(
          "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center select-none",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <input
          type="checkbox"
          ref={inputRef}
          checked={isChecked}
          disabled={disabled}
          onChange={(e) => {
            onCheckedChange?.(e.target.checked)
          }}
          className="peer sr-only"
          {...props}
        />
        <span
          data-state={isIndeterminate ? "indeterminate" : isChecked ? "checked" : "unchecked"}
          className={cn(
            "flex size-4 items-center justify-center rounded-[4px] border border-input shadow-xs transition-colors",
            "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
            (isChecked || isIndeterminate) && "border-primary bg-primary text-primary-foreground",
            !isChecked && !isIndeterminate && "bg-background hover:bg-muted/50",
            className
          )}
        >
          {isIndeterminate ? (
            <Minus className="size-3 stroke-[3]" />
          ) : isChecked ? (
            <Check className="size-3 stroke-[3]" />
          ) : null}
        </span>
      </label>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
