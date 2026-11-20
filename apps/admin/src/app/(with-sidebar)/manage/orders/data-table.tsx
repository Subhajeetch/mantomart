"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Loader2, PackageSearch, Search, X, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableViewOptions } from "./data-table-view-options"
import { AdminOrderSummary } from "./types"

interface DataTableProps {
  columns: ColumnDef<AdminOrderSummary>[]
  data: AdminOrderSummary[]
  loading?: boolean
  // Server-side search & filter props
  searchInput: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  isSearching?: boolean
  statusFilter: string
  onStatusChange: (status: string) => void
  paymentFilter: string
  onPaymentChange: (paymentStatus: string) => void
  onResetFilters: () => void
  isFiltered: boolean
  // Server pagination props
  page: number
  pageSize: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  // Bulk actions
  onBulkCancel?: (orders: AdminOrderSummary[]) => void
  canCancel?: boolean
}

export function DataTable({
  columns,
  data,
  loading = false,
  searchInput,
  onSearchChange,
  onClearSearch,
  isSearching = false,
  statusFilter,
  onStatusChange,
  paymentFilter,
  onPaymentChange,
  onResetFilters,
  isFiltered,
  page,
  pageSize,
  totalPages,
  totalCount,
  onPageChange,
  onPageSizeChange,
  onBulkCancel,
  canCancel = true,
}: DataTableProps) {
  const router = useRouter()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "createdAt", desc: true },
  ])
  // Order ID is hidden by default as requested
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    id: false,
  })
  const [rowSelection, setRowSelection] = React.useState({})

  const table = useReactTable({
    data,
    columns,
    pageCount: Math.max(1, totalPages),
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: {
        pageIndex: Math.max(0, page - 1),
        pageSize,
      },
    },
    manualPagination: true,
    manualFiltering: true,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: Math.max(0, page - 1), pageSize })
          : updater
      if (next.pageIndex !== page - 1) {
        onPageChange(next.pageIndex + 1)
      }
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize)
      }
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selectedRows = table.getFilteredSelectedRowModel().rows

  if (!mounted) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="h-64 animate-pulse bg-muted/20" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search Input with Debounce feedback */}
          <div className="relative w-full sm:w-[260px] md:w-[320px]">
            {isSearching ? (
              <Loader2 className="absolute left-2.5 top-2.5 h-4 w-4 animate-spin text-primary" />
            ) : (
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            )}
            <Input
              placeholder="Search customer, price, email, id..."
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 pl-8 pr-8 text-sm"
            />
            {searchInput && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearSearch}
                className="absolute right-1 top-1 h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Clear search</span>
              </Button>
            )}
          </div>

          {/* Status Select */}
          <Select value={statusFilter} onValueChange={onStatusChange}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>

          {/* Payment Status Select */}
          <Select value={paymentFilter} onValueChange={onPaymentChange}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>

          {/* Reset Filters Button */}
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Reset
              <X className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* View Options Toggle (Duplicate refresh button removed) */}
        <div className="flex items-center gap-2">
          <DataTableViewOptions table={table} />
        </div>
      </div>

      {/* Bulk selection action bar */}
      {selectedRows.length > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-4 py-2 text-sm border border-border">
          <span className="text-muted-foreground">
            <strong className="text-foreground">{selectedRows.length}</strong>{" "}
            order(s) selected
          </span>
          <div className="flex items-center gap-2">
            {canCancel && onBulkCancel && (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  const ordersToCancel = selectedRows
                    .map((r) => r.original)
                    .filter(
                      (o) => o.status !== "cancelled" && o.status !== "refunded"
                    )
                  if (ordersToCancel.length > 0) {
                    onBulkCancel(ordersToCancel)
                  }
                }}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Cancel Selected
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => table.toggleAllRowsSelected(false)}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table Container */}
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/30">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="py-3">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              // Skeleton loading state
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_, colIndex) => (
                    <TableCell key={`skeleton-cell-${colIndex}`} className="py-4">
                      <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => router.push(`/manage/order/${row.original.id}`)}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-44 text-center"
                >
                  <div className="flex flex-col items-center justify-center space-y-2 text-muted-foreground">
                    <PackageSearch className="h-10 w-10 stroke-[1.5]" />
                    <p className="text-sm font-medium">No orders found.</p>
                    <p className="text-xs text-muted-foreground/80">
                      {isFiltered
                        ? "Try clearing your filters or search terms."
                        : "Orders placed by customers will appear here."}
                    </p>
                    {isFiltered && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onResetFilters}
                        className="mt-2 h-8 text-xs"
                      >
                        Reset filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls with Database Total */}
      <DataTablePagination table={table} totalCount={totalCount} />
    </div>
  )
}
