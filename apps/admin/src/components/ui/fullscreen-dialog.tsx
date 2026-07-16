"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/**
 * Radix Dialog locks body scroll via react-remove-scroll. Fullscreen close can
 * leave overflow/pointer-events stuck, so we force a cleanup after close.
 */
function restoreBodyScroll() {
  if (typeof document === "undefined") return

  const body = document.body
  const html = document.documentElement

  body.style.removeProperty("overflow")
  body.style.removeProperty("pointer-events")
  body.style.removeProperty("padding-right")
  body.style.removeProperty("margin-right")
  body.removeAttribute("data-scroll-locked")
  body.removeAttribute("data-aria-hidden")

  html.style.removeProperty("overflow")
  html.style.removeProperty("pointer-events")
  html.style.removeProperty("padding-right")

  // Clear leftover scroll-lock markers from remove-scroll
  document.querySelectorAll("[data-scroll-locked]").forEach((el) => {
    if (el !== body) el.removeAttribute("data-scroll-locked")
  })
}

function FullscreenDialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  React.useEffect(() => {
    if (open) return

    // Immediate + delayed cleanup (after close animation / remove-scroll teardown)
    restoreBodyScroll()
    const t1 = window.setTimeout(restoreBodyScroll, 50)
    const t2 = window.setTimeout(restoreBodyScroll, 300)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [open])

  React.useEffect(() => {
    return () => {
      restoreBodyScroll()
    }
  }, [])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        restoreBodyScroll()
        window.setTimeout(restoreBodyScroll, 50)
        window.setTimeout(restoreBodyScroll, 300)
      }
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  return (
    <DialogPrimitive.Root
      data-slot="fullscreen-dialog"
      open={open}
      onOpenChange={handleOpenChange}
      {...props}
    />
  )
}

function FullscreenDialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return (
    <DialogPrimitive.Trigger data-slot="fullscreen-dialog-trigger" {...props} />
  )
}

function FullscreenDialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return (
    <DialogPrimitive.Portal data-slot="fullscreen-dialog-portal" {...props} />
  )
}

function FullscreenDialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close data-slot="fullscreen-dialog-close" {...props} />
  )
}

function FullscreenDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="fullscreen-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function FullscreenDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <FullscreenDialogPortal>
      <FullscreenDialogOverlay />
      <DialogPrimitive.Content
        data-slot="fullscreen-dialog-content"
        className={cn(
          "fixed inset-0 z-50 flex h-full w-full max-h-none max-w-none flex-col gap-0 rounded-none border-0 bg-background p-0 text-sm text-foreground shadow-none outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="fullscreen-dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3 z-10"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </FullscreenDialogPortal>
  )
}

function FullscreenDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="fullscreen-dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b bg-background px-4 py-3 sm:px-6 sm:py-4",
        className
      )}
      {...props}
    />
  )
}

function FullscreenDialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="fullscreen-dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  )
}

function FullscreenDialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="fullscreen-dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function FullscreenDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="fullscreen-dialog-title"
      className={cn(
        "font-heading text-base leading-none font-semibold sm:text-lg",
        className
      )}
      {...props}
    />
  )
}

function FullscreenDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="fullscreen-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  FullscreenDialog,
  FullscreenDialogClose,
  FullscreenDialogContent,
  FullscreenDialogDescription,
  FullscreenDialogFooter,
  FullscreenDialogHeader,
  FullscreenDialogBody,
  FullscreenDialogOverlay,
  FullscreenDialogPortal,
  FullscreenDialogTitle,
  FullscreenDialogTrigger,
}
