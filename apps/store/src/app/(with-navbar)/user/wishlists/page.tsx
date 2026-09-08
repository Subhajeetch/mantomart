'use client';

import {
  BookHeart,
  Bookmark,
  Briefcase,
  Flower2,
  Gamepad2,
  Gift,
  Heart,
  Home,
  Loader2,
  Plane,
  ShoppingBag,
  Sparkles,
  Star,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';

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
import { useWishlist } from '@/components/wishlist-context';
import type { WishlistFolder } from '@/components/wishlist-context';
import { cn } from '@/lib/utils';

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

function apiUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`;
}

export default function WishlistsPage() {
  const { addFolder, folders: contextFolders } = useWishlist();
  const [folders, setFolders] = useState<WishlistFolder[]>(contextFolders);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('Heart');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFolders(contextFolders);
  }, [contextFolders]);

  useEffect(() => {
    let mounted = true;
    void fetch(apiUrl('/api/store/wishlists'), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load wishlists.');
        const body = (await response.json()) as { data?: { folders?: WishlistFolder[] } };
        if (mounted && Array.isArray(body.data?.folders)) setFolders(body.data.folders);
      })
      .catch((cause) => mounted && setError(cause instanceof Error ? cause.message : 'Unable to load wishlists.'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const createFolder = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/store/wishlists/folders'), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon }),
      });
      const body = (await response.json()) as { error?: string; data?: { folder?: WishlistFolder } };
      if (!response.ok || !body.data?.folder) {
        setError(body.error ?? 'Unable to create folder.');
        return;
      }
      addFolder(body.data.folder);
      setName('');
      setCreateOpen(false);
    } catch {
      setError('Unable to reach your wishlist.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background">
      <div className="mx-auto max-w-6xl space-y-8 p-5 md:p-10">
        <header className="flex items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Shopping</p>
            <h1 className="text-2xl font-semibold tracking-tight">Wishlists</h1>
            <p className="mt-2 text-sm text-muted-foreground">Keep the products you love in one place.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-none"><Plus /> New folder</Button>
        </header>

        {error ? <p className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : folders.length === 0 ? (
          <div className="border border-border p-12 text-center">
            <Heart className="mx-auto size-8 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Start a collection</h2>
            <p className="mt-2 text-sm text-muted-foreground">Save products to Favourites or create a folder for every idea.</p>
          </div>
        ) : (
          <div className="space-y-10">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((folder) => {
                const Icon = iconMap[folder.icon as keyof typeof iconMap] ?? Heart;
                return (
                  <Link key={folder.id} href={`/user/wishlist/${folder.id}`} className="group border border-border bg-background p-5 transition-colors hover:border-primary/60">
                    <div className="flex items-center justify-between">
                      <span className="flex size-11 items-center justify-center bg-primary/10 text-primary"><Icon className="size-5" /></span>
                      <span className="text-xs font-semibold text-muted-foreground">{folder.totalProducts} {folder.totalProducts === 1 ? 'item' : 'items'}</span>
                    </div>
                    <h2 className="mt-5 font-semibold group-hover:text-primary">{folder.name}</h2>
                    {folder.isDefault ? <p className="mt-1 text-xs text-muted-foreground">Your default collection</p> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create wishlist folder</DialogTitle><DialogDescription>Give your collection a name and choose an icon.</DialogDescription></DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Gift ideas" />
          <div className="grid grid-cols-6 gap-2">
            {Object.entries(iconMap).map(([key, Icon]) => (
              <button key={key} type="button" onClick={() => setIcon(key)} className={cn('flex h-10 items-center justify-center border', icon === key ? 'border-primary bg-primary/10 text-primary' : 'border-border')} aria-label={key}><Icon className="size-4" /></button>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void createFolder()} disabled={saving || !name.trim()}>{saving ? <Loader2 className="animate-spin" /> : 'Create folder'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
