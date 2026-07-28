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
  description: string | null;
  image: string | null;
  position: number;
  isVisible: boolean;
  featured: boolean;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
};

type HeaderAdminCollection = {
  id: string;
  name: string;
  slug: string;
  href: string | null;
  description: string | null;
  image: string | null;
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
  name: string;
  slug: string;
  href: string;
  description: string;
  image: string;
  position: number;
  isVisible: boolean;
};

type ItemForm = CollectionForm & {
  featured: boolean;
};

const blankCollection: CollectionForm = {
  name: "",
  slug: "",
  href: "",
  description: "",
  image: "",
  position: 0,
  isVisible: true,
};

const blankItem: ItemForm = {
  ...blankCollection,
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
    name: collection.name,
    slug: collection.slug,
    href: collection.href || null,
    description: collection.description || null,
    image: collection.image || null,
    position: Number(collection.position) || 0,
    isVisible: collection.isVisible,
  };
}

function itemPayload(item: HeaderAdminItem) {
  return {
    name: item.name,
    slug: item.slug,
    href: item.href || null,
    description: item.description || null,
    image: item.image || null,
    position: Number(item.position) || 0,
    isVisible: item.isVisible,
    featured: item.featured,
  };
}

function formPayload(form: CollectionForm | ItemForm) {
  return {
    name: form.name,
    slug: form.slug || undefined,
    href: form.href || null,
    description: form.description || null,
    image: form.image || null,
    position: Number(form.position) || 0,
    isVisible: form.isVisible,
    ...("featured" in form ? { featured: form.featured } : {}),
  };
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
        meta: HeaderMeta;
      }>("/");
      setCollections(response.data);
      setMeta(response.meta);
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
      const response = await requestJson<{ success: true; message?: string }>(
        "/collections",
        {
          method: "POST",
          body: JSON.stringify(formPayload(newCollection)),
        }
      );
      toast.success(response.message || "Collection created.");
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
      const response = await requestJson<{ success: true; message?: string }>(
        `/collections/${collectionId}/items`,
        {
          method: "POST",
          body: JSON.stringify(formPayload(form)),
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
                  <Field id="new-collection-name" label="Name" className="md:col-span-2">
                    <Input
                      id="new-collection-name"
                      value={newCollection.name}
                      disabled={!canUpdate}
                      onChange={(event) => {
                        const name = event.target.value;
                        setNewCollection((prev) => ({
                          ...prev,
                          name,
                          slug: prev.slug || slugify(name),
                        }));
                      }}
                    />
                  </Field>
                  <Field id="new-collection-slug" label="Slug" className="md:col-span-2">
                    <Input
                      id="new-collection-slug"
                      value={newCollection.slug}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          slug: slugify(event.target.value),
                        }))
                      }
                    />
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
                  <Field id="new-collection-href" label="Href" className="md:col-span-3">
                    <Input
                      id="new-collection-href"
                      placeholder="/c/fashion"
                      value={newCollection.href}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          href: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field id="new-collection-image" label="Image" className="md:col-span-3">
                    <Input
                      id="new-collection-image"
                      value={newCollection.image}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          image: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field id="new-collection-description" label="Description" className="md:col-span-6">
                    <Textarea
                      id="new-collection-description"
                      value={newCollection.description}
                      disabled={!canUpdate}
                      onChange={(event) =>
                        setNewCollection((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                  </Field>
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
                  <Card key={collection.id}>
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
                        <Field id={`${collection.id}-name`} label="Name" className="md:col-span-2">
                          <Input
                            id={`${collection.id}-name`}
                            value={collection.name}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                name: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field id={`${collection.id}-slug`} label="Slug" className="md:col-span-2">
                          <Input
                            id={`${collection.id}-slug`}
                            value={collection.slug}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                slug: slugify(event.target.value),
                              })
                            }
                          />
                        </Field>
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
                        <Field id={`${collection.id}-href`} label="Href" className="md:col-span-3">
                          <Input
                            id={`${collection.id}-href`}
                            value={fieldValue(collection.href)}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                href: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field id={`${collection.id}-image`} label="Image" className="md:col-span-3">
                          <Input
                            id={`${collection.id}-image`}
                            value={fieldValue(collection.image)}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                image: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field id={`${collection.id}-description`} label="Description" className="md:col-span-6">
                          <Textarea
                            id={`${collection.id}-description`}
                            value={fieldValue(collection.description)}
                            disabled={!canUpdate}
                            onChange={(event) =>
                              updateCollectionLocal(collection.id, {
                                description: event.target.value,
                              })
                            }
                          />
                        </Field>
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
                              <Field id={`${item.id}-slug`} label="Slug" className="md:col-span-2">
                                <Input
                                  id={`${item.id}-slug`}
                                  value={item.slug}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      slug: slugify(event.target.value),
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
                              <Field id={`${item.id}-href`} label="Href" className="md:col-span-3">
                                <Input
                                  id={`${item.id}-href`}
                                  value={fieldValue(item.href)}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      href: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field id={`${item.id}-image`} label="Image" className="md:col-span-3">
                                <Input
                                  id={`${item.id}-image`}
                                  value={fieldValue(item.image)}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      image: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field id={`${item.id}-description`} label="Description" className="md:col-span-6">
                                <Textarea
                                  id={`${item.id}-description`}
                                  value={fieldValue(item.description)}
                                  disabled={!canUpdate}
                                  onChange={(event) =>
                                    updateItemLocal(collection.id, item.id, {
                                      description: event.target.value,
                                    })
                                  }
                                />
                              </Field>
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
                                  (meta?.maxItemsPerCollection ?? 40)
                              }
                              onClick={() => void createItem(collection.id)}
                            >
                              <Plus className="size-3.5" />
                              Add item
                            </Button>
                          </div>

                          <NewItemForm
                            collectionId={collection.id}
                            disabled={!canUpdate}
                            value={newItems[collection.id] ?? blankItem}
                            onChange={(value) =>
                              setNewItems((prev) => ({
                                ...prev,
                                [collection.id]: value,
                              }))
                            }
                          />
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
  disabled,
  value,
  onChange,
}: {
  collectionId: string;
  disabled: boolean;
  value: ItemForm;
  onChange: (value: ItemForm) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-6">
      <Field id={`${collectionId}-new-item-name`} label="Name" className="md:col-span-2">
        <Input
          id={`${collectionId}-new-item-name`}
          value={value.name}
          disabled={disabled}
          onChange={(event) => {
            const name = event.target.value;
            onChange({ ...value, name, slug: value.slug || slugify(name) });
          }}
        />
      </Field>
      <Field id={`${collectionId}-new-item-slug`} label="Slug" className="md:col-span-2">
        <Input
          id={`${collectionId}-new-item-slug`}
          value={value.slug}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, slug: slugify(event.target.value) })
          }
        />
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
      <Field id={`${collectionId}-new-item-href`} label="Href" className="md:col-span-3">
        <Input
          id={`${collectionId}-new-item-href`}
          value={value.href}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, href: event.target.value })}
        />
      </Field>
      <Field id={`${collectionId}-new-item-image`} label="Image" className="md:col-span-3">
        <Input
          id={`${collectionId}-new-item-image`}
          value={value.image}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, image: event.target.value })}
        />
      </Field>
      <Field id={`${collectionId}-new-item-description`} label="Description" className="md:col-span-6">
        <Textarea
          id={`${collectionId}-new-item-description`}
          value={value.description}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </Field>
    </div>
  );
}
