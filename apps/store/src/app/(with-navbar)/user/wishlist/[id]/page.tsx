'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  BookHeart,
  Bookmark,
  Briefcase,
  Ellipsis,
  Flower2,
  Gamepad2,
  Gift,
  Heart,
  Home,
  Loader2,
  ArrowUpRight,
  Pencil,
  Plane,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import {
  useWishlist,
  type WishlistFolder,
  type WishlistProduct,
} from '@/components/wishlist-context';
import { formatPriceCents } from '@/components/homepage/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

function apiUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`;
}

const iconMap = {
  Heart,
  Star,
  Gift,
  ShoppingBag,
  Sparkles,
  Home,
  Briefcase,
  Plane,
  Flower2,
  Gamepad2,
  BookHeart,
  Bookmark,
} as const;

type Action = 'move' | 'delete' | null;

export default function WishlistFolderPage() {
  const params = useParams<{ id: string }>();
  const { folders, refresh } = useWishlist();
  const [folder, setFolder] = useState<WishlistFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [activeProduct, setActiveProduct] = useState<WishlistProduct | null>(
    null
  );
  const [targetFolderId, setTargetFolderId] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('Heart');
  const [savingEdit, setSavingEdit] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const folderId = typeof params.id === 'string' ? params.id : '';
  const otherFolders = useMemo(
    () => folders.filter((item) => item.id !== folderId),
    [folderId, folders]
  );
  const selectedTargetFolder = otherFolders.find(
    (item) => item.id === targetFolderId
  );

  useEffect(() => {
    if (!folderId) return;
    let mounted = true;
    setLoading(true);
    setError('');
    void fetch(apiUrl(`/api/store/wishlists/${encodeURIComponent(folderId)}`), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          data?: { folder?: WishlistFolder };
          error?: string;
          message?: string;
        } | null;
        if (!response.ok || !body?.data?.folder) {
          throw new Error(
            body?.error ?? body?.message ?? 'Unable to load this wishlist.'
          );
        }
        if (mounted) setFolder(body.data.folder);
      })
      .catch((cause) => {
        if (mounted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load this wishlist.'
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [folderId]);

  const openAction = (
    nextAction: Exclude<Action, null>,
    product: WishlistProduct
  ) => {
    setActiveProduct(product);
    setAction(nextAction);
    setTargetFolderId(otherFolders[0]?.id ?? '');
    setError('');
  };

  const closeAction = () => {
    if (requesting) return;
    setAction(null);
    setActiveProduct(null);
    setTargetFolderId('');
  };

  const removeProduct = async () => {
    if (!folder || !activeProduct) return;
    setRequesting(true);
    setError('');
    try {
      const response = await fetch(
        apiUrl(
          `/api/store/wishlists/${encodeURIComponent(folder.id)}/products/${encodeURIComponent(activeProduct.id)}`
        ),
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          body?.error ?? body?.message ?? 'Unable to remove this product.'
        );
      setFolder((current) =>
        current
          ? {
              ...current,
              totalProducts: Math.max(0, current.totalProducts - 1),
              productIds: current.productIds.filter(
                (id) => id !== activeProduct.id
              ),
              products: current.products.filter(
                (product) => product.id !== activeProduct.id
              ),
            }
          : current
      );
      await refresh();
      closeAction();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to remove this product.'
      );
    } finally {
      setRequesting(false);
    }
  };

  const moveProduct = async () => {
    if (!folder || !activeProduct || !targetFolderId) return;
    setRequesting(true);
    setError('');
    try {
      const response = await fetch(
        apiUrl(
          `/api/store/wishlists/${encodeURIComponent(folder.id)}/products/${encodeURIComponent(activeProduct.id)}/move`
        ),
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ targetFolderId }),
        }
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.error ?? body?.message ?? 'Unable to update this wishlist.'
        );
      }
      setFolder((current) =>
        current
          ? {
              ...current,
              totalProducts: Math.max(0, current.totalProducts - 1),
              productIds: current.productIds.filter(
                (id) => id !== activeProduct.id
              ),
              products: current.products.filter(
                (product) => product.id !== activeProduct.id
              ),
            }
          : current
      );
      await refresh();
      closeAction();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this wishlist.'
      );
    } finally {
      setRequesting(false);
    }
  };

  const saveFolder = async () => {
    if (!folder || !editName.trim()) return;
    setSavingEdit(true);
    setError('');
    try {
      const response = await fetch(
        apiUrl(`/api/store/wishlists/${encodeURIComponent(folder.id)}`),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: editName.trim(), icon: editIcon }),
        }
      );
      const body = (await response.json().catch(() => null)) as {
        data?: { folder?: WishlistFolder };
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !body?.data?.folder) {
        throw new Error(
          body?.error ?? body?.message ?? 'Unable to update this folder.'
        );
      }
      setFolder((current) =>
        current ? { ...current, ...body.data!.folder } : current
      );
      await refresh();
      setEditOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to update this folder.'
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const openEdit = () => {
    if (!folder) return;
    setEditName(folder.name);
    setEditIcon(folder.icon);
    setError('');
    setEditOpen(true);
  };

  const Icon = folder
    ? (iconMap[folder.icon as keyof typeof iconMap] ?? Heart)
    : Heart;

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background">
      <div className="mx-auto max-w-6xl space-y-8 p-5 md:p-10">
        <Link
          href="/user/wishlists"
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All wishlists
        </Link>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error && !folder ? (
          <div className="border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            {error}
          </div>
        ) : folder ? (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-border pb-6">
              <div className="flex items-center gap-4">
                <span className="flex size-12 items-center justify-center bg-primary/10 text-primary">
                  <Icon className="size-6" />
                </span>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {folder.name}
                  </h1>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {folder.totalProducts}{' '}
                    {folder.totalProducts === 1 ? 'item' : 'items'}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={openEdit}
                aria-label="Edit wishlist folder"
              >
                <Pencil className="size-4" />
              </Button>
            </header>

            {error ? (
              <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {folder.products.length === 0 ? (
              <div className="border border-dashed border-border p-12 text-center">
                <Heart className="mx-auto size-8 text-primary" />
                <h2 className="mt-4 text-lg font-semibold">
                  This folder is empty
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Save products from the storefront and they will appear here.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {folder.products.map((product) => (
                  <article
                    key={product.id}
                    className="relative flex min-w-0 gap-4 border border-border bg-background p-3"
                  >
                    <Link
                      href={`/product/${product.slug}`}
                      className="size-28 shrink-0 overflow-hidden bg-muted sm:size-36"
                    >
                      {product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image}
                          alt={product.name}
                          className="size-full object-cover transition-transform duration-300 hover:scale-105"
                        />
                      ) : null}
                    </Link>
                    <div className="min-w-0 flex-1 py-1 pr-8">
                      <Link href={`/product/${product.slug}`} className="group">
                        <h2 className="line-clamp-3 text-sm font-semibold text-foreground/85 group-hover:text-primary">
                          {product.name}
                        </h2>
                        {product.price !== null ? (
                          <p className="mt-3 text-sm font-semibold">
                            {formatPriceCents(product.price)}
                          </p>
                        ) : null}
                      </Link>
                    </div>
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="absolute top-2 right-2"
                            aria-label={`Actions for ${product.name}`}
                          />
                        }
                      >
                        <Ellipsis className="size-4" />
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-44 p-1">
                        <button
                          type="button"
                          onClick={() => openAction('move', product)}
                          className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs hover:bg-muted"
                        >
                          <ArrowUpRight className="size-4" /> Move to
                        </button>
                        <button
                          type="button"
                          onClick={() => openAction('delete', product)}
                          className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-4" /> Delete
                        </button>
                      </PopoverContent>
                    </Popover>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {isDesktop ? (
        <Dialog
          open={action === 'move'}
          onOpenChange={(open) => !open && closeAction()}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Move product</DialogTitle>
              <DialogDescription>
                Choose the wishlist folder where this product should be saved.
              </DialogDescription>
            </DialogHeader>
            {otherFolders.length > 0 ? (
              <Select
                value={targetFolderId}
                onValueChange={(value) => setTargetFolderId(value ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a folder">
                    {selectedTargetFolder ? (
                      <>
                        {(() => {
                          const FolderIcon =
                            iconMap[
                              selectedTargetFolder.icon as keyof typeof iconMap
                            ] ?? Heart;
                          return <FolderIcon className="size-4" />;
                        })()}
                        <span>{selectedTargetFolder.name}</span>
                      </>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {otherFolders.map((item) => {
                    const FolderIcon =
                      iconMap[item.icon as keyof typeof iconMap] ?? Heart;
                    return (
                      <SelectItem key={item.id} value={item.id}>
                        <FolderIcon className="size-4" /> {item.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : (
              <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">
                Create another wishlist folder before moving this product.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeAction}
                disabled={requesting}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void moveProduct()}
                disabled={requesting || !targetFolderId}
              >
                {requesting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Move product'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={action === 'move'}
          onOpenChange={(open) => !open && closeAction()}
          showSwipeHandle
        >
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>Move product</DrawerTitle>
              <DrawerDescription>
                Choose the wishlist folder where this product should be saved.
              </DrawerDescription>
            </DrawerHeader>
            <div className="grid gap-2 p-4">
              {otherFolders.length > 0 ? (
                otherFolders.map((item) => {
                  const FolderIcon =
                    iconMap[item.icon as keyof typeof iconMap] ?? Heart;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setTargetFolderId(item.id)}
                      className={cn(
                        'flex items-center gap-3 border p-3 text-left text-sm',
                        targetFolderId === item.id &&
                          'border-primary bg-primary/10 text-primary'
                      )}
                    >
                      <FolderIcon className="size-4" /> {item.name}
                    </button>
                  );
                })
              ) : (
                <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Create another wishlist folder before moving this product.
                </p>
              )}
            </div>
            <DrawerFooter>
              <Button
                variant="outline"
                onClick={closeAction}
                disabled={requesting}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void moveProduct()}
                disabled={requesting || !targetFolderId}
              >
                {requesting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Move product'
                )}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {isDesktop ? (
        <Dialog
          open={action === 'delete'}
          onOpenChange={(open) => !open && closeAction()}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove from wishlist?</DialogTitle>
              <DialogDescription>
                This will remove the product from{' '}
                <strong>{folder?.name}</strong>. You can save it again later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeAction}
                disabled={requesting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void removeProduct()}
                disabled={requesting}
              >
                {requesting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Delete product'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={action === 'delete'}
          onOpenChange={(open) => !open && closeAction()}
          showSwipeHandle
        >
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>Remove from wishlist?</DrawerTitle>
              <DrawerDescription>
                This will remove the product from{' '}
                <strong>{folder?.name}</strong>. You can save it again later.
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <Button
                variant="outline"
                onClick={closeAction}
                disabled={requesting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void removeProduct()}
                disabled={requesting}
              >
                {requesting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Delete product'
                )}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {isDesktop ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit wishlist folder</DialogTitle>
              <DialogDescription>
                Change your collection name and icon.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder="Gift ideas"
            />
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(iconMap).map(([key, FolderIcon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditIcon(key)}
                  className={cn(
                    'flex h-10 items-center justify-center border',
                    editIcon === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border'
                  )}
                  aria-label={key}
                >
                  <FolderIcon className="size-4" />
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveFolder()}
                disabled={savingEdit || !editName.trim()}
              >
                {savingEdit ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Save changes'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={editOpen} onOpenChange={setEditOpen} showSwipeHandle>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>Edit wishlist folder</DrawerTitle>
              <DrawerDescription>
                Change your collection name and icon.
              </DrawerDescription>
            </DrawerHeader>
            <div className="grid gap-4 p-4">
              <Input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Gift ideas"
              />
              <div className="grid grid-cols-6 gap-2">
                {Object.entries(iconMap).map(([key, FolderIcon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setEditIcon(key)}
                    className={cn(
                      'flex h-10 items-center justify-center border',
                      editIcon === key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border'
                    )}
                    aria-label={key}
                  >
                    <FolderIcon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
            <DrawerFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveFolder()}
                disabled={savingEdit || !editName.trim()}
              >
                {savingEdit ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  'Save changes'
                )}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
