"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type HeaderAdminItem = {
  id: string;
  name: string;
  slug: string;
  href: string | null;
  position: number;
  isVisible: boolean;
  featured: boolean;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
};

type HeaderAdminCollection = {
  id: string;
  categoryId: string | null;
  name: string;
  slug: string;
  href: string | null;
  position: number;
  isVisible: boolean;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
  items: HeaderAdminItem[];
};

type HeaderMeta = {
  totalCollections: number;
  visibleCollections: number;
  maxVisibleCollections: number;
  maxTotalCollections: number;
  maxItemsPerCollection: number;
  currentUserRole: string;
  canUpdate: boolean;
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type CollectionForm = {
  categoryId: string; // selected existing category id
  position: number;
  isVisible: boolean;
};


type ItemForm = {
  categoryId: string; // will reference an existing child category
  position: number;
  isVisible: boolean;
  featured: boolean;
};

const blankCollection: CollectionForm = {
  categoryId: "",
  position: 0,
  isVisible: true,
};

const blankItem: ItemForm = {
  categoryId: "",
  position: 0,
  isVisible: true,
  featured: false,
};

function getHeaderApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}/api/admin/header` : "/api/admin/header";
}

async function requestJson<T>(path: string, options: RequestInit = {}) {
  const base = getHeaderApiBase();
  const url =
    !path || path === "/"
      ? base
      : path.startsWith("?")
        ? `${base}${path}`
        : `${base}/${path.replace(/^\/+/, "")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Unable to reach the server. Please try again.", 0);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(`Request failed with status ${response.status}.`, response.status);
  }

  if (!response.ok || (data as ApiErrorBody).success === false) {
    const body = data as ApiErrorBody;
    throw new ApiError(
      body.error || body.message || `Request failed with status ${response.status}.`,
      response.status,
      body.code
    );
  }

  return data as T;
}

function fieldValue(value: string | null) {
  return value ?? "";
}

function collectionPayload(collection: HeaderAdminCollection) {
  return {
    categoryId: collection.categoryId ?? undefined,
    position: Number(collection.position) || 0,
    isVisible: collection.isVisible,
  };
}

function itemPayload(item: HeaderAdminItem) {
  return {
    name: item.name,
    slug: item.slug,
    href: item.href || null,
    position: Number(item.position) || 0,
    isVisible: item.isVisible,
    featured: item.featured,
  };
}

function formPayload(form: CollectionForm | ItemForm) {
  // Support the simplified forms: map to fields accepted by API
  const base: Record<string, unknown> = {
    categoryId: (form as any).categoryId ?? undefined,
    position: Number((form as any).position) || 0,
    isVisible: (form as any).isVisible ?? true,
    image: (form as any).image ?? null,
  };
  if ((form as any).featured !== undefined) base.featured = (form as any).featured;
  return base;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function VisibilityBadge({ visible }: { visible: boolean }) {
  return visible ? (
    <Badge variant="secondary" className="gap-1">
      <Eye className="size-3" />
      Visible
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <EyeOff className="size-3" />
      Hidden
    </Badge>
  );
}

export default function EditHeaderPage() {
  const [collections, setCollections] = useState<HeaderAdminCollection[]>([]);
  const [meta, setMeta] = useState<HeaderMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState<CollectionForm>(blankCollection);
  const [newItems, setNewItems] = useState<Record<string, ItemForm>>({});
  const [availableCategories, setAvailableCategories] = useState<{
    id: string;
    name: string;
    slug: string;
    image: string | null;
    position: number;
    childCount: number;
  }[]>([]);
  const [categoryTree, setCategoryTree] = useState<any[] | null>(null); // raw category tree from API for looking up children


  const canUpdate = meta?.canUpdate ?? false;
  const visibleCount = useMemo(
    () => collections.filter((collection) => collection.isVisible).length,
    [collections]
  );

  const loadHeader = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await requestJson<{
        success: true;
        data: HeaderAdminCollection[];
        availableCategories?: { id: string; name: string; slug: string; image: string | null; position: number; childCount: number }[];
        meta: HeaderMeta;
      }>("/");
      setCollections(response.data);
      setMeta(response.meta);
      setAvailableCategories(response.availableCategories ?? []);

      // load full category tree for child lookups (used for item selection)
      try {
        const treeRes = await fetch('/api/admin/categories/tree', { credentials: 'include' });
        if (treeRes.ok) {
          const parsed = await treeRes.json();
          setCategoryTree(parsed?.data ?? null);
        }
      } catch (err) {
        // non-fatal: category tree optional
        setCategoryTree(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load header.";
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadHeader();
  }, [loadHeader]);

  function updateCollectionLocal(
    id: string,
    patch: Partial<HeaderAdminCollection>
  ) {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === id ? { ...collection, ...patch } : collection
      )
    );
  }

  function updateItemLocal(
    collectionId: string,
    itemId: string,
    patch: Partial<HeaderAdminItem>
  ) {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              items: collection.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
          : collection
      )
    );
  }

  async function createCollection() {
    setBusyKey("collection:new");
    try {
      if (!newCollection.categoryId) {
        toast.error('Select a category to add to the header.');
        setBusyKey(null);
        return;
      }

      const payload = {
        categoryId: newCollection.categoryId,
        position: newCollection.position,
        isVisible: newCollection.isVisible,
      };

      const response = await requestJson<{ success: true; message?: string }>(
        "/collections",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      toast.success(response.message || "Collection created.");
      // Attempt to refresh public store header (rebuild KV cache) so storefront reflects changes immediately.
      try {
        await fetch('/api/store/header', { credentials: 'include', cache: 'no-store' });
      } catch (e) {
        // ignore
      }
      setNewCollection(blankCollection);
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create collection.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveCollection(collection: HeaderAdminCollection) {
    setBusyKey(`collection:${collection.id}`);
    try {
      const response = await requestJson<{ success: true; message?: string }>(
        `/collections/${collection.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(collectionPayload(collection)),
        }
      );
      toast.success(response.message || "Collection updated.");
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update collection.");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteCollection(collection: HeaderAdminCollection) {
    if (!window.confirm(`Delete "${collection.name}" and all of its items?`)) return;

    setBusyKey(`collection:${collection.id}:delete`);
    try {
      const response = await requestJson<{ success: true; message?: string }>(
        `/collections/${collection.id}`,
        { method: "DELETE" }
      );
      toast.success(response.message || "Collection deleted.");
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete collection.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createItem(collectionId: string) {
    const form = newItems[collectionId] ?? blankItem;
    setBusyKey(`item:new:${collectionId}`);
    try {
      // If a categoryId was chosen, map it to a payload from the category tree
      let payload: any = null;
      if (form.categoryId && categoryTree) {
        function findNode(list: any[], id: string): any | null {
          for (const node of list) {
            if (node.id === id) return node;
            if (node.children) {
              const found = findNode(node.children, id);
              if (found) return found;
            }
          }
          return null;
        }
        const node = findNode(categoryTree, form.categoryId);
        if (!node) {
          throw new Error('Selected category not found.');
        }
        payload = {
          name: node.name,
          slug: node.slug,
          href: `/category/${node.slug}`,
          image: node.image ?? null,
          position: form.position ?? 0,
          isVisible: form.isVisible,
          featured: form.featured ?? false,
        };
      } else {
        throw new Error('Select an existing category to add as an item.');
      }

      const response = await requestJson<{ success: true; message?: string }>(
        `/collections/${collectionId}/items`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      toast.success(response.message || "Item created.");
      setNewItems((prev) => ({ ...prev, [collectionId]: blankItem }));
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create item.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveItem(item: HeaderAdminItem) {
    setBusyKey(`item:${item.id}`);
    try {
      const response = await requestJson<{ success: true; message?: string }>(
        `/items/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(itemPayload(item)),
        }
      );
      toast.success(response.message || "Item updated.");
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update item.");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteItem(item: HeaderAdminItem) {
    if (!window.confirm(`Delete "${item.name}" from the header?`)) return;

    setBusyKey(`item:${item.id}:delete`);
    try {
      const response = await requestJson<{ success: true; message?: string }>(
        `/items/${item.id}`,
        { method: "DELETE" }
      );
      toast.success(response.message || "Item deleted.");
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setBusyKey(null);
    }
  }

  async function reorderCollections(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= collections.length) return;

    const next = [...collections];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);

    const ordered = next.map((collection, index) => ({
      id: collection.id,
      position: index * 10,
    }));
    setCollections(
      next.map((collection, index) => ({ ...collection, position: index * 10 }))
    );

    setBusyKey("reorder:collections");
    try {
      await requestJson("/reorder", {
        method: "PUT",
        body: JSON.stringify({ collections: ordered }),
      });
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder collections.");
      await loadHeader(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function reorderItems(
    collectionId: string,
    fromIndex: number,
    toIndex: number
  ) {
    const collection = collections.find((entry) => entry.id === collectionId);
    if (!collection || toIndex < 0 || toIndex >= collection.items.length) return;

    const nextItems = [...collection.items];
    const [moved] = nextItems.splice(fromIndex, 1);
    if (!moved) return;
    nextItems.splice(toIndex, 0, moved);

    const ordered = nextItems.map((item, index) => ({
      id: item.id,
      position: index * 10,
    }));
    setCollections((prev) =>
      prev.map((entry) =>
        entry.id === collectionId
          ? {
              ...entry,
              items: nextItems.map((item, index) => ({
                ...item,
                position: index * 10,
              })),
            }
          : entry
      )
    );

    setBusyKey(`reorder:items:${collectionId}`);
    try {
      await requestJson("/reorder", {
        method: "PUT",
        body: JSON.stringify({ items: ordered }),
      });
      await loadHeader(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder items.");
      await loadHeader(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function invalidateCache() {
    setBusyKey("cache");
    try {
      const response = await requestJson<{ success: true; message?: string }>(
        "/invalidate-cache",
        { method: "POST" }
      );
      toast.success(response.message || "Header cache invalidated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invalidate cache.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Store Header</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="sr-only text-2xl font-semibold tracking-tight">
              Store Header
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {visibleCount}/{meta?.maxVisibleCollections ?? 5} visible
              </Badge>
              <Badge variant="outline">
                {collections.length}/{meta?.maxTotalCollections ?? 20} total
              </Badge>
              <Badge variant="outline">
                {meta?.currentUserRole ?? "admin"}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Edit the collection groups and dropdown items shown in the
              storefront navbar. Public nav data is cached in KV for 5 days and
              is invalidated automatically after changes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadHeader(true)}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("size-3.5", refreshing && "animate-spin")}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void invalidateCache()}
              disabled={!canUpdate || busyKey === "cache"}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              Invalidate cache
            </Button>
          </div>
        </div>

        {!canUpdate && !loading && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              You can view the header, but updating it requires the
              header:update permission or owner role.
            </p>
          </div>
        )}

        {loading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading header editor...
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="size-8 text-destructive" />
              <div>
                <p className="font-medium">Could not load header</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadHeader()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="grid gap-4 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">New collection</h2>
                    <p className="text-xs text-muted-foreground">
                      Only the first {meta?.maxVisibleCollections ?? 5} visible
                      collections render in the store navbar.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!canUpdate || busyKey === "collection:new"}
                    onClick={() => void createCollection()}
                  >
                    <Plus className="size-3.5" />
                    Add collection
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-6">
                  <Field id="new-collection-category" label="Category" className="md:col-span-3">
                    <select
                      id="new-collection-category"
                      className="w-full rounded-md border px-2 py-1"
                      value={newCollection.categoryId}
                      disabled={!canUpdate}
                      onChange={(e) => setNewCollection((prev) => ({ ...prev, categoryId: e.target.value }))}
                    >
                      <option value="">Select a root category…</option>
                      {availableCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name} {cat.childCount ? `(${cat.childCount} children)` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field id="new-collection-position" label="Position">
                    <Input
                      id="new-collection-position"
                      type="number"
                      min={0}
                      value={newCollection.position}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          position: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </Field>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={newCollection.isVisible}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          isVisible: event.target.checked,
                        }))
                      }
                    />
                    Visible
                  </label>

                </div>
              </CardContent>
            </Card>

            {collections.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="font-medium">No header collections yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add a collection above to start building the store navbar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {collections.map((collection, index) => (
                  <Card
                    key={collection.id}
                    draggable={canUpdate}
                    onDragStart={(e) => {
                      e.dataTransfer?.setData('text/plain', String(index));
                      e.dataTransfer?.setData('application/drag-kind', 'header-collection');
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer?.getData('text/plain') ?? -1);
                      const kind = e.dataTransfer?.getData('application/drag-kind');
                      if (kind !== 'header-collection') return;
                      const to = index;
                      if (from >= 0 && from !== to) {
                        void reorderCollections(from, to);
                      }
                    }}
                  >
                    <CardContent className="grid gap-5 p-4">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold">
                              {collection.name || "Untitled collection"}
                            </h2>
                            <VisibilityBadge visible={collection.isVisible} />
                            <Badge variant="outline">
                              {collection.items.length}/
                              {meta?.maxItemsPerCollection ?? 40} items
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            /c/{collection.slug} fallback, position{" "}
                            {collection.position}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon-sm"
                            disabled={!canUpdate || index === 0 || busyKey !== null}
                            onClick={() => void reorderCollections(index, index - 1)}
                            aria-label="Move collection up"
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            disabled={
                              !canUpdate ||
                              index === collections.length - 1 ||
                              busyKey !== null
                            }
                            onClick={() => void reorderCollections(index, index + 1)}
                            aria-label="Move collection down"
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={
                              !canUpdate || busyKey === `collection:${collection.id}`
                            }
                            onClick={() => void saveCollection(collection)}
                          >
                            <Save className="size-3.5" />
                            Save
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="gap-1.5"
                            disabled={
                              !canUpdate ||
                              busyKey === `collection:${collection.id}:delete`
                            }
                            onClick={() => void deleteCollection(collection)}
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-6">
                        <div className="md:col-span-6 grid gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Top-level category:</span>
                            <span className="text-sm text-muted-foreground">{collection.name} · /category/{collection.slug}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground">Change category</label>
                            <select
                              className="rounded-md border px-2 py-1"
                              value={collection.categoryId ?? ''}
                              disabled={!canUpdate}
                              onChange={async (e) => {
                                const newCatId = e.target.value;
                                if (!newCatId) return;
                                setBusyKey(`collection:${collection.id}`);
                                try {
                                  await requestJson(`/collections/${collection.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ categoryId: newCatId }),
                                  });
                                  toast.success('Category swapped.');
                                  await loadHeader(true);
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : 'Failed to swap category.');
                                } finally {
                                  setBusyKey(null);
                                }
                              }}
                            >
                              <option value="">(keep current)</option>
                              {availableCategories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <Field id={`${collection.id}-position`} label="Position">
                          <Input
                            id={`${collection.id}-position`}
                            type="number"
                            min={0}
                            value={collection.position}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                position: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </Field>
                        <label className="flex items-end gap-2 pb-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={collection.isVisible}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                isVisible: event.target.checked,
                              })
                            }
                          />
                          Visible
                        </label>
                      </div>

                      <Separator />

                      <div className="grid gap-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Dropdown items</h3>
                        </div>

                        {collection.items.map((item, itemIndex) => (
                          <div
                            key={item.id}
                            className="grid gap-3 border bg-muted/20 p-3"
                            draggable={canUpdate}
                            onDragStart={(e) => {
                              e.dataTransfer?.setData('text/plain', String(itemIndex));
                              e.dataTransfer?.setData('application/drag-kind', 'header-item');
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = Number(e.dataTransfer?.getData('text/plain') ?? -1);
                              const kind = e.dataTransfer?.getData('application/drag-kind');
                              if (kind !== 'header-item') return;
                              const to = itemIndex;
                              if (from >= 0 && from !== to) {
                                void reorderItems(collection.id, from, to);
                              }
                            }}
                          >
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">
                                  {item.name || "Untitled item"}
                                </span>
                                <VisibilityBadge visible={item.isVisible} />
                                {item.featured && (
                                  <Badge variant="secondary">Featured</Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  disabled={
                                    !canUpdate || itemIndex === 0 || busyKey !== null
                                  }
                                  onClick={() =>
                                    void reorderItems(
                                      collection.id,
                                      itemIndex,
                                      itemIndex - 1
                                    )
                                  }
                                  aria-label="Move item up"
                                >
                                  <ArrowUp className="size-3.5" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  disabled={
                                    !canUpdate ||
                                    itemIndex === collection.items.length - 1 ||
                                    busyKey !== null
                                  }
                                  onClick={() =>
                                    void reorderItems(
                                      collection.id,
                                      itemIndex,
                                      itemIndex + 1
                                    )
                                  }
                                  aria-label="Move item down"
                                >
                                  <ArrowDown className="size-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={!canUpdate || busyKey === `item:${item.id}`}
                                  onClick={() => void saveItem(item)}
                                >
                                  <Save className="size-3.5" />
                                  Save
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={
                                    !canUpdate ||
                                    busyKey === `item:${item.id}:delete`
                                  }
                                  onClick={() => void deleteItem(item)}
                                >
                                  <Trash2 className="size-3.5" />
                                  Delete
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-6">
                              <Field id={`${item.id}-name`} label="Name" className="md:col-span-2">
                                <Input
                                  id={`${item.id}-name`}
                                  value={item.name}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      name: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field id={`${item.id}-position`} label="Position">
                                <Input
                                  id={`${item.id}-position`}
                                  type="number"
                                  min={0}
                                  value={item.position}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      position: Number(event.target.value) || 0,
                                    })
                                  }
                                />
                              </Field>
                              <div className="grid gap-2 pt-5 text-sm">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    checked={item.isVisible}
                                    disabled={!canUpdate}
                                    onChange={(event) =>
                                      updateItemLocal(collection.id, item.id, {
                                        isVisible: event.target.checked,
                                      })
                                    }
                                  />
                                  Visible
                                </label>
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    checked={item.featured}
                                    disabled={!canUpdate}
                                    onChange={(event) =>
                                      updateItemLocal(collection.id, item.id, {
                                        featured: event.target.checked,
                                      })
                                    }
                                  />
                                  Featured
                                </label>
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="grid gap-3 border border-dashed p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h4 className="text-sm font-medium">New item</h4>
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={
                                !canUpdate ||
                                busyKey === `item:new:${collection.id}` ||
                                collection.items.length >=
                                  (meta?.maxItemsPerCollection ?? 40) ||
                                !!collection.categoryId // when category linked, manage children in categories admin
                              }
                              onClick={() => void createItem(collection.id)}
                            >
                              <Plus className="size-3.5" />
                              Add item
                            </Button>
                          </div>

                          {collection.categoryId ? (
                            <div className="text-sm text-muted-foreground">
                              This header collection mirrors the category "{collection.name}". Manage its child categories in the Categories admin to control the storefront menu columns.
                            </div>
                          ) : (
                            <NewItemForm
                              collectionId={collection.id}
                              rootCategoryId={collection.categoryId}
                              categoryTree={categoryTree}
                              disabled={!canUpdate}
                              value={newItems[collection.id] ?? blankItem}
                              onChange={(value) =>
                                setNewItems((prev) => ({
                                  ...prev,
                                  [collection.id]: value,
                                }))
                              }
                            />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function NewItemForm({
  collectionId,
  rootCategoryId,
  categoryTree,
  disabled,
  value,
  onChange,
}: {
  collectionId: string;
  rootCategoryId?: string | null;
  categoryTree?: any[] | null;
  disabled: boolean;
  value: ItemForm;
  onChange: (value: ItemForm) => void;
}) {
  // derive available child categories from categoryTree if provided
  let childOptions: { id: string; name: string; slug: string }[] = [];
  if (rootCategoryId && Array.isArray(categoryTree)) {
    // find node matching rootCategoryId
    function findNode(list: any[], id: string): any | null {
      for (const node of list) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findNode(node.children, id);
          if (found) return found;
        }
      }
      return null;
    }
    const root = findNode(categoryTree, rootCategoryId);
    if (root && Array.isArray(root.children)) {
      childOptions = root.children.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug }));
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-6">
      <Field id={`${collectionId}-new-item-category`} label="Category" className="md:col-span-3">
        <select
          id={`${collectionId}-new-item-category`}
          value={value.categoryId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, categoryId: e.target.value })}
          className="w-full rounded-md border px-2 py-1"
        >
          <option value="">Select child category…</option>
          {childOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
      </Field>

      <Field id={`${collectionId}-new-item-position`} label="Position">
        <Input
          id={`${collectionId}-new-item-position`}
          type="number"
          min={0}
          value={value.position}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, position: Number(event.target.value) || 0 })
          }
        />
      </Field>
      <div className="grid gap-2 pt-5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.isVisible}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, isVisible: event.target.checked })
            }
          />
          Visible
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.featured}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, featured: event.target.checked })
            }
          />
          Featured
        </label>
      </div>

    </div>
  );
}
