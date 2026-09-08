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
  X,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Session } from '@repo/types/session-client';
import { useSession } from '@/lib/auth-client';
import { formatPriceCents } from '@/components/homepage/format';
import { cn } from '@/lib/utils';
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
import { toast } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const icons = {
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
type IconName = keyof typeof icons;

export type WishlistProduct = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  price: number | null;
};

export type WishlistFolder = {
  id: string;
  name: string;
  icon: string;
  isDefault: boolean;
  totalProducts: number;
  productIds: string[];
  products: WishlistProduct[];
};

type PickerProduct = WishlistProduct;
type WishlistContextValue = {
  folders: WishlistFolder[];
  isLoading: boolean;
  pulse: boolean;
  openPicker: (product: PickerProduct) => void;
  toggleProduct: (product: PickerProduct) => void;
  addFolder: (folder: Omit<WishlistFolder, 'products'>) => void;
  isSaved: (productId: string) => boolean;
  active: PickerProduct | null;
  pickerOpen: boolean;
  selectedFolderId: string;
  selectedFolder: WishlistFolder | undefined;
  selectedHasProduct: boolean;
  autoSaving: boolean;
  requesting: boolean;
  error: string;
  closePicker: () => void;
  chooseFolder: (value: string | null) => void;
  saveToFolder: (folderId: string) => Promise<boolean>;
  cancelAutoSave: () => void;
  manualSaveRequired: boolean;
  refresh: () => Promise<void>;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

function apiUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return `${base}${path}`;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

function folderIcon(name: string) {
  return icons[(name in icons ? name : 'Heart') as IconName];
}

export function useWishlist() {
  const value = useContext(WishlistContext);
  if (!value) throw new Error('useWishlist must be used inside WishlistProvider');
  return value;
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  const session = data as Session | null;
  const [folders, setFolders] = useState<WishlistFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [active, setActive] = useState<PickerProduct | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderIcon, setNewFolderIcon] = useState<IconName>('Heart');
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [autoSaving, setAutoSaving] = useState(false);
  const [manualSaveRequired, setManualSaveRequired] = useState(false);
  const [pulse, setPulse] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFolders = useCallback(async () => {
    if (!session?.user?.id) {
      setFolders([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(apiUrl('/api/store/wishlists'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: { folders?: WishlistFolder[] } };
        setFolders(
          Array.isArray(body.data?.folders)
            ? body.data.folders.map((folder) => ({
                ...folder,
                productIds: Array.isArray(folder.productIds)
                  ? folder.productIds
                  : folder.products.map((product) => product.id),
                products: Array.isArray(folder.products) ? folder.products : [],
              }))
            : []
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const savedIds = useMemo(
    () => new Set(folders.flatMap((folder) => folder.productIds)),
    [folders]
  );

  const cancelAutoSave = useCallback(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = null;
    setAutoSaving(false);
    setManualSaveRequired(true);
  }, []);

  const closePicker = useCallback(() => {
    cancelAutoSave();
    setPickerOpen(false);
    setActive(null);
    setError('');
    setManualSaveRequired(false);
  }, [cancelAutoSave]);

  const openPicker = useCallback(
    (product: PickerProduct) => {
      if (!session?.user?.id) {
        window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const defaultFolder = folders.find((folder) => folder.isDefault) ?? folders[0];
      setActive(product);
      setSelectedFolderId(defaultFolder?.id ?? '');
      setError('');
      setManualSaveRequired(false);
      setPickerOpen(true);
    },
    [folders, session?.user?.id]
  );

  const saveToFolder = useCallback(
    async (folderId: string, product = active) => {
      if (!product || !folderId) return false;
      setRequesting(true);
      setError('');
      try {
        const response = await fetch(apiUrl(`/api/store/wishlists/${folderId}/products`), {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: product.id }),
        });
        if (!response.ok) {
          setError(await responseMessage(response, 'Unable to save this product.'));
          return false;
        }
        setFolders((current) =>
          current.map((folder) =>
            folder.id === folderId &&
            !folder.productIds.includes(product.id) &&
            !folder.products.some((item) => item.id === product.id)
              ? {
                  ...folder,
                  totalProducts: folder.totalProducts + 1,
                  productIds: folder.productIds.includes(product.id)
                    ? folder.productIds
                    : [product.id, ...folder.productIds],
                  products: [product, ...folder.products],
                }
              : folder
          )
        );
        setPulse(true);
        window.setTimeout(() => setPulse(false), 650);
        toast.add({
          title: 'Saved to your wishlist',
          description: product.name,
        });
        return true;
      } catch {
        setError('Unable to reach your wishlist. Please try again.');
        return false;
      } finally {
        setRequesting(false);
      }
    },
    [active]
  );

  const removeFromFolder = useCallback(async (folderId: string, productId: string) => {
    setRequesting(true);
    setError('');
    try {
      const response = await fetch(
        apiUrl(`/api/store/wishlists/${folderId}/products/${productId}`),
        { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!response.ok) {
        setError(await responseMessage(response, 'Unable to remove this product.'));
        return false;
      }
      setFolders((current) =>
        current.map((folder) =>
          folder.id === folderId
            ? {
                ...folder,
                totalProducts: Math.max(0, folder.totalProducts - 1),
                productIds: folder.productIds.filter((id) => id !== productId),
                products: folder.products.filter((item) => item.id !== productId),
              }
            : folder
        )
      );
      toast.add({
        title: 'Removed from your wishlist',
        description: 'The product is no longer saved in that folder.',
      });
      return true;
    } catch {
      setError('Unable to reach your wishlist. Please try again.');
      return false;
    } finally {
      setRequesting(false);
    }
  }, []);

  const toggleProduct = useCallback(
    (product: PickerProduct) => {
      const savedFolder = folders.find((folder) =>
        folder.productIds.includes(product.id) ||
        folder.products.some((item) => item.id === product.id)
      );
      if (savedFolder) {
        void removeFromFolder(savedFolder.id, product.id);
      } else {
        openPicker(product);
      }
    },
    [folders, openPicker, removeFromFolder]
  );

  const addFolder = useCallback((folder: Omit<WishlistFolder, 'products'>) => {
    setFolders((current) => {
      if (current.some((item) => item.id === folder.id)) return current;
      return [
        ...current,
        {
          ...folder,
          productIds: Array.isArray(folder.productIds) ? folder.productIds : [],
          products: [],
        },
      ];
    });
  }, []);

  useEffect(() => {
    if (!pickerOpen || !active || !selectedFolderId) return;
    const selected = folders.find((folder) => folder.id === selectedFolderId);
    if (
      !selected?.isDefault ||
      manualSaveRequired ||
      selected.productIds.includes(active.id) ||
      selected.products.some((product) => product.id === active.id)
    ) {
      return;
    }
    setAutoSaving(true);
    autoSaveRef.current = setTimeout(async () => {
      setAutoSaving(false);
      if (await saveToFolder(selected.id)) closePicker();
    }, 3000);
    return cancelAutoSave;
  }, [active, cancelAutoSave, closePicker, folders, manualSaveRequired, pickerOpen, saveToFolder, savedIds, selectedFolderId]);

  const chooseFolder = (value: string | null) => {
    cancelAutoSave();
    if (!value) return;
    if (value === '__create__') {
      setCreateOpen(true);
      return;
    }
    setSelectedFolderId(value);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setRequesting(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/store/wishlists/folders'), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon: newFolderIcon }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, 'Unable to create this folder.'));
        return;
      }
      const body = (await response.json()) as { data?: { folder?: WishlistFolder } };
      const folder = body.data?.folder;
      if (folder) {
        setFolders((current) => [...current, { ...folder, productIds: [], products: [] }]);
        setSelectedFolderId(folder.id);
      }
      setNewFolderName('');
      setCreateOpen(false);
    } catch {
      setError('Unable to reach your wishlist. Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId);
  const selectedHasProduct = Boolean(
    selectedFolder &&
      active &&
      (selectedFolder.productIds.includes(active.id) ||
        selectedFolder.products.some((product) => product.id === active.id))
  );

  const value = useMemo<WishlistContextValue>(
    () => ({
      folders,
      isLoading,
      pulse,
      openPicker,
      toggleProduct,
      addFolder,
      isSaved: (id) => savedIds.has(id),
      active,
      pickerOpen,
      selectedFolderId,
      selectedFolder,
      selectedHasProduct,
      autoSaving,
      requesting,
      error,
      closePicker,
      chooseFolder,
      saveToFolder,
      cancelAutoSave,
      manualSaveRequired,
      refresh: loadFolders,
    }),
    [
      active,
      addFolder,
      autoSaving,
      cancelAutoSave,
      chooseFolder,
      closePicker,
      error,
      folders,
      isLoading,
      openPicker,
      pickerOpen,
      pulse,
      requesting,
      saveToFolder,
      savedIds,
      selectedFolder,
      selectedFolderId,
      selectedHasProduct,
      toggleProduct,
      manualSaveRequired,
      loadFolders,
    ]
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create wishlist folder</DialogTitle>
            <DialogDescription>Give this collection a name and an icon.</DialogDescription>
          </DialogHeader>
          <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Weekend ideas" autoFocus />
          <div className="grid grid-cols-6 gap-2">
            {Object.entries(icons).map(([name, Icon]) => (
              <button type="button" key={name} onClick={() => setNewFolderIcon(name as IconName)} className={cn('flex h-10 items-center justify-center border', newFolderIcon === name ? 'border-primary bg-primary/10 text-primary' : 'border-border')} aria-label={name}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void createFolder()} disabled={requesting || !newFolderName.trim()}>{requesting ? <Loader2 className="animate-spin" /> : 'Create folder'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WishlistContext.Provider>
  );
}

export function WishlistPicker() {
  const {
    folders,
    active,
    pickerOpen,
    selectedFolderId,
    selectedFolder,
    selectedHasProduct,
    autoSaving,
    manualSaveRequired,
    requesting,
    error,
    closePicker,
    chooseFolder,
    saveToFolder,
    cancelAutoSave,
  } = useWishlist();
  const ActiveIcon = selectedFolder ? folderIcon(selectedFolder.icon) : Heart;

  if (!pickerOpen || !active) return null;

  return (
    <section onPointerDown={cancelAutoSave} className="absolute top-full right-0 z-40 mt-2 w-[min(28rem,calc(100vw-1.5rem))] border border-foreground/10 bg-background shadow-2xl" role="dialog" aria-label="Save to wishlist">
      <div className="flex items-center gap-3 p-3">
        <div className="size-14 shrink-0 overflow-hidden bg-muted">
          {active.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={active.image} alt="" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{active.name}</p>
          {active.price !== null ? <p className="mt-1 text-xs text-muted-foreground">{formatPriceCents(active.price)}</p> : null}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={closePicker} aria-label="Close wishlist picker"><X /></Button>
      </div>
      <div className="border-t p-3">
        <Select value={selectedFolderId} onValueChange={chooseFolder}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue><ActiveIcon className="size-4" />{selectedFolder?.name ?? 'Choose a folder'}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {folders.map((folder) => {
              const Icon = folderIcon(folder.icon);
              return <SelectItem value={folder.id} key={folder.id}><Icon className="size-4" />{folder.name}</SelectItem>;
            })}
            <SelectItem value="__create__"><span className="font-semibold text-primary">+ Create a new folder</span></SelectItem>
          </SelectContent>
        </Select>
        <div className="mt-3 min-h-10">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {selectedFolder?.isDefault && !selectedHasProduct && autoSaving ? (
            <div className="mt-3 h-0.5 overflow-hidden bg-muted"><div className="h-full origin-left animate-[wishlist-progress_3s_linear] bg-[#ff3f6c]" /></div>
          ) : null}
          {!selectedFolder?.isDefault || manualSaveRequired ? (
            <Button
              className="h-10 w-full animate-in rounded-none fade-in slide-in-from-bottom-1 duration-200"
              disabled={requesting || !selectedFolderId || selectedHasProduct}
              onClick={async () => {
                cancelAutoSave();
                if (await saveToFolder(selectedFolderId)) closePicker();
              }}
            >
              {requesting ? <Loader2 className="animate-spin" /> : 'Save to folder'}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
