'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSession } from '@/lib/auth-client';
import type { Session } from '@repo/types/session-client';

import { getColumns } from './columns';
import { DataTable } from './data-table';
import { OrderStatsDialog } from './components/order-stats-dialog';
import {
  AdminOrderSummary,
  OrderActionCallbacks,
  OrderListMeta,
  OrderStatus,
  OrderStats,
} from './types';
import { formatMoney, requestJson } from './utils';

const DEFAULT_PAGE_SIZE = 20;

export default function OrdersPage() {
  const { data: sessionData } = useSession();
  const session = sessionData as Session | null;

  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [meta, setMeta] = useState<OrderListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Lazy-loaded stats dialog state (saves DB reads on page load)
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Single cancellation dialog state
  const [cancelTarget, setCancelTarget] = useState<AdminOrderSummary | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Bulk cancellation dialog state
  const [bulkCancelTargets, setBulkCancelTargets] = useState<AdminOrderSummary[]>([]);
  const [bulkCancelling, setBulkCancelling] = useState(false);

  const canManage = meta?.canManage ?? session?.user.role === 'owner';
  const canCancel = meta?.canCancel ?? session?.user.role === 'owner';

  // 600ms Debounce effect for search
  useEffect(() => {
    if (searchInput.trim() !== debouncedSearch) {
      setIsDebouncing(true);
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setIsDebouncing(false);
      setPage(1);
    }, 600);

    return () => clearTimeout(timer);
  }, [searchInput, debouncedSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setIsDebouncing(false);
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((status: string) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handlePaymentChange = useCallback((payment: string) => {
    setPaymentFilter(payment);
    setPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setStatusFilter('all');
    setPaymentFilter('all');
    setIsDebouncing(false);
    setPage(1);
  }, []);

  // Fetch orders with current filters & pagination
  const loadOrders = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (page > 1) params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (paymentFilter !== 'all') params.set('paymentStatus', paymentFilter);

        const qs = params.toString();
        const ordersRes = await requestJson<{
          success: true;
          data: AdminOrderSummary[];
          meta: OrderListMeta;
        }>(`/all${qs ? `?${qs}` : ''}`);

        setOrders(ordersRes.data);
        setMeta(ordersRes.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load orders.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, pageSize, debouncedSearch, statusFilter, paymentFilter]
  );

  // Fetch stats on-demand
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await requestJson<{
        success: true;
        data: OrderStats;
      }>('/stats');
      setStats(res.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load order statistics.';
      toast.error(message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // Fetch stats only when the stats dialog is opened
  useEffect(() => {
    if (statsDialogOpen && !stats) {
      void loadStats();
    }
  }, [statsDialogOpen, stats, loadStats]);

  // Handle marking an order as fulfilled
  const handleMarkFulfilled = useCallback(
    async (order: AdminOrderSummary) => {
      try {
        const res = await requestJson<{
          success: true;
          message?: string;
          data: AdminOrderSummary;
        }>(`/${order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isFulfilled: true }),
        });

        toast.success(res.message || 'Order marked as fulfilled.');

        // Update local state
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, ...res.data, isFulfilled: true, status: 'fulfilled' }
              : o
          )
        );

        if (stats) {
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  unfulfilledCount: Math.max(0, prev.unfulfilledCount - 1),
                  byStatus: {
                    ...prev.byStatus,
                    fulfilled: (prev.byStatus.fulfilled || 0) + 1,
                  },
                }
              : null
          );
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to mark order as fulfilled.';
        toast.error(message);
      }
    },
    [stats]
  );

  // Handle status update
  const handleStatusUpdate = useCallback(
    async (order: AdminOrderSummary, nextStatus: OrderStatus) => {
      try {
        const res = await requestJson<{
          success: true;
          message?: string;
          data: AdminOrderSummary;
        }>(`/${order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        });

        toast.success(res.message || `Order status updated to ${nextStatus}.`);

        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, ...res.data, status: nextStatus } : o
          )
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to update order status.';
        toast.error(message);
      }
    },
    []
  );

  // Open cancel dialog
  const handleOpenCancelDialog = useCallback((order: AdminOrderSummary) => {
    setCancelTarget(order);
    setCancelReason('');
  }, []);

  // Submit order cancellation
  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);

    try {
      const res = await requestJson<{
        success: true;
        message?: string;
      }>(`/${cancelTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });

      toast.success(res.message || 'Order cancelled successfully.');

      setOrders((prev) =>
        prev.map((o) =>
          o.id === cancelTarget.id
            ? {
                ...o,
                status: 'cancelled',
                cancelReason: cancelReason.trim() || 'Cancelled by admin',
                cancelledAt: new Date().toISOString(),
              }
            : o
        )
      );

      setCancelTarget(null);
      setCancelReason('');
      void loadOrders(true);
      if (stats) void loadStats();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to cancel order.';
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  // Bulk cancel handler
  const handleBulkCancel = (targets: AdminOrderSummary[]) => {
    setBulkCancelTargets(targets);
  };

  const handleConfirmBulkCancel = async () => {
    if (bulkCancelTargets.length === 0) return;
    setBulkCancelling(true);

    let succeeded = 0;
    let failed = 0;

    for (const order of bulkCancelTargets) {
      try {
        await requestJson(`/${order.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Bulk cancellation by admin' }),
        });
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }

    if (succeeded > 0) {
      toast.success(`Successfully cancelled ${succeeded} order(s).`);
    }
    if (failed > 0) {
      toast.error(`Failed to cancel ${failed} order(s).`);
    }

    setBulkCancelTargets([]);
    setBulkCancelling(false);
    void loadOrders(true);
    if (stats) void loadStats();
  };

  const callbacks: OrderActionCallbacks = useMemo(
    () => ({
      onStatusUpdate: handleStatusUpdate,
      onMarkFulfilled: handleMarkFulfilled,
      onCancelOrder: handleOpenCancelDialog,
    }),
    [handleStatusUpdate, handleMarkFulfilled, handleOpenCancelDialog]
  );

  const columns = useMemo(
    () => getColumns(callbacks, { canManage, canCancel }),
    [callbacks, canManage, canCancel]
  );

  const isFiltered =
    Boolean(debouncedSearch || searchInput) ||
    statusFilter !== 'all' ||
    paymentFilter !== 'all';

  return (
    <>
      {/* Header Breadcrumb & Actions */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-background px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage className="font-semibold text-base sm:text-lg">
                  Order Management
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {/* Header Actions: Stats Dialog button + Primary Refresh button */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStatsDialogOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span>Stats</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadOrders(false)}
            disabled={loading || refreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing || loading ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 space-y-4 p-4 md:p-6 lg:p-8">
        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5" />
              <div>
                <p className="font-semibold text-sm">Failed to load orders</p>
                <p className="text-xs opacity-90">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadOrders(false)}
              className="h-8 text-xs border-destructive/30 hover:bg-destructive/10"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Data Table Section with 600ms Debounced Server Search & Pagination */}
        <DataTable
          columns={columns}
          data={orders}
          loading={loading}
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          onClearSearch={handleClearSearch}
          isSearching={isDebouncing}
          statusFilter={statusFilter}
          onStatusChange={handleStatusChange}
          paymentFilter={paymentFilter}
          onPaymentChange={handlePaymentChange}
          onResetFilters={handleResetFilters}
          isFiltered={isFiltered}
          page={page}
          pageSize={pageSize}
          totalPages={meta?.totalPages ?? 1}
          totalCount={meta?.total ?? orders.length}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          onBulkCancel={handleBulkCancel}
          canCancel={canCancel}
        />
      </main>

      {/* Order Statistics Dialog (Fetched On-Demand) */}
      <OrderStatsDialog
        open={statsDialogOpen}
        onOpenChange={setStatsDialogOpen}
        stats={stats}
        loading={statsLoading}
        onRefresh={loadStats}
      />

      {/* Cancel Order Dialog */}
      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            setCancelReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Cancel Order #{cancelTarget?.id.slice(0, 10)}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel the order for{' '}
              <strong className="text-foreground">
                {cancelTarget?.customerName}
              </strong>{' '}
              ({formatMoney(cancelTarget?.totalCents)})? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label
              htmlFor="cancel-reason"
              className="text-xs font-medium text-muted-foreground"
            >
              Cancellation Reason (Optional)
            </label>
            <Input
              id="cancel-reason"
              placeholder="e.g. Customer requested, out of stock, duplicate..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="h-9 text-sm"
              maxLength={200}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              Keep Order
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Cancel Dialog */}
      <Dialog
        open={bulkCancelTargets.length > 0}
        onOpenChange={(open) => {
          if (!open) setBulkCancelTargets([]);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Cancel {bulkCancelTargets.length} Selected Orders
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel all {bulkCancelTargets.length}{' '}
              selected orders? This will update their statuses to cancelled.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setBulkCancelTargets([])}
              disabled={bulkCancelling}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkCancel}
              disabled={bulkCancelling}
            >
              {bulkCancelling ? 'Cancelling...' : 'Confirm Bulk Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
