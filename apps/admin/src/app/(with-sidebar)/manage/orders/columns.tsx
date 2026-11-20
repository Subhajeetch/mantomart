"use client"

import { ColumnDef } from "@tanstack/react-table"
import Link from "next/link"
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  MoreHorizontal,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTableColumnHeader } from "./data-table-column-header"
import { AdminOrderSummary, OrderActionCallbacks } from "./types"
import {
  formatDateTime,
  formatMoney,
  getOrderStatusBadgeVariant,
  getPaymentStatusBadgeVariant,
} from "./utils"

export function getColumns(
  callbacks?: OrderActionCallbacks,
  meta?: { canManage?: boolean; canCancel?: boolean }
): ColumnDef<AdminOrderSummary>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "totalCents",
      id: "total",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Price" />
      ),
      cell: ({ row }) => {
        const order = row.original
        const formatted = formatMoney(order.totalCents, order.currency)

        return (
          <div className="font-semibold text-sm tabular-nums text-foreground">
            {formatted}
          </div>
        )
      },
    },
    {
      accessorKey: "customerName",
      id: "customer",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Customer" />
      ),
      cell: ({ row }) => {
        const order = row.original

        return (
          <div className="flex flex-col">
            <span className="font-medium text-sm text-foreground">
              {order.customerName}
            </span>
            <span
              className="text-xs text-muted-foreground truncate max-w-[200px]"
              title={order.customerEmail}
            >
              {order.customerEmail}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      id: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.original.status
        const badgeInfo = getOrderStatusBadgeVariant(status)

        return (
          <div className="flex items-center gap-2">
            <Badge
              variant={badgeInfo.variant}
              className={`capitalize px-2 py-0.5 text-xs font-medium border ${badgeInfo.className}`}
            >
              {badgeInfo.label}
            </Badge>
            {row.original.isFulfilled && status !== "fulfilled" && (
              <Badge
                variant="outline"
                className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
              >
                Fulfilled
              </Badge>
            )}
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: "paymentStatus",
      id: "paymentStatus",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Payment" />
      ),
      cell: ({ row }) => {
        const order = row.original
        const badgeInfo = getPaymentStatusBadgeVariant(order.paymentStatus)

        return (
          <div className="flex flex-col gap-0.5">
            <div>
              <Badge
                variant="outline"
                className={`text-[11px] font-medium border ${badgeInfo.className}`}
              >
                {badgeInfo.label}
              </Badge>
            </div>
            <span className="text-[11px] text-muted-foreground capitalize">
              {order.paymentMethod.replace(/_/g, " ")}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "totalItemsCount",
      id: "items",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Items" />
      ),
      cell: ({ row }) => {
        const order = row.original
        const firstItem = order.itemsPreview?.[0]
        const additionalCount = Math.max(0, order.totalItemsCount - (firstItem?.quantity || 1))

        return (
          <div className="flex flex-col text-xs max-w-[180px]">
            <span className="font-medium text-foreground">
              {order.totalItemsCount} {order.totalItemsCount === 1 ? "item" : "items"}
            </span>
            {firstItem && (
              <span
                className="text-muted-foreground truncate"
                title={firstItem.productName}
              >
                {firstItem.productName}
                {additionalCount > 0 && ` +${additionalCount} more`}
              </span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      id: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Date" />
      ),
      cell: ({ row }) => {
        return (
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDateTime(row.original.createdAt)}
          </div>
        )
      },
    },
    {
      accessorKey: "id",
      id: "id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order ID" />
      ),
      cell: ({ row }) => {
        const order = row.original
        const shortId = order.id.length > 10 ? `${order.id.slice(0, 10)}...` : order.id

        return (
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <Link
              href={`/manage/order/${order.id}`}
              className="font-medium text-primary hover:underline hover:text-primary/80"
              title={order.id}
            >
              #{shortId}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard.writeText(order.id)
                toast.success("Order ID copied to clipboard")
              }}
              title="Copy ID"
            >
              <Copy className="h-3 w-3" />
              <span className="sr-only">Copy ID</span>
            </Button>
          </div>
        )
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const order = row.original
        const canManage = meta?.canManage ?? true
        const canCancel = meta?.canCancel ?? true

        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(order.id)
                    toast.success("Order ID copied to clipboard")
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy Order ID
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(order.customerEmail)
                    toast.success("Customer email copied")
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy Email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/manage/order/${order.id}`}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    View Details
                  </Link>
                </DropdownMenuItem>

                {canManage && !order.isFulfilled && order.status !== "cancelled" && callbacks?.onMarkFulfilled && (
                  <DropdownMenuItem
                    onClick={() => callbacks.onMarkFulfilled?.(order)}
                  >
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-600" />
                    Mark Fulfilled
                  </DropdownMenuItem>
                )}

                {canManage && order.status === "ordered" && callbacks?.onStatusUpdate && (
                  <DropdownMenuItem
                    onClick={() => callbacks.onStatusUpdate?.(order, "processing")}
                  >
                    <Clock className="mr-2 h-3.5 w-3.5 text-amber-600" />
                    Set Processing
                  </DropdownMenuItem>
                )}

                {canCancel && order.status !== "cancelled" && order.status !== "refunded" && callbacks?.onCancelOrder && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => callbacks.onCancelOrder?.(order)}
                    >
                      <XCircle className="mr-2 h-3.5 w-3.5" />
                      Cancel Order
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]
}
