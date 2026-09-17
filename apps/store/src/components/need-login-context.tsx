'use client';

import * as React from 'react';

import type { Session } from '@repo/types/session-client';
import Image from 'next/image';

import { useMediaQuery } from '@/hooks/use-media-query';
import { useSession } from '@/lib/auth-client';
import { getStoreLoginUrl } from '@/lib/app-urls';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export type NeedLoginOptions = {
  /** Dialog heading. Defaults to "Log in to continue". */
  title?: string;
  /** Supporting copy under the title. */
  description?: string;
  /**
   * Where to send the shopper after a successful login. Defaults to the
   * current page URL so they always land back where they left off. Must be an
   * absolute store/admin URL — LoginClient rejects anything else.
   */
  returnTo?: string;
  /**
   * Invoked once a session is available while the dialog is still mounted
   * (e.g. an inline sign-in). Not fired across a full `/login` navigation —
   * callers that need post-login actions use the `returnTo` URL instead.
   */
  onSuccess?: () => void;
  /** Invoked when the shopper closes the dialog without signing in. */
  onDismiss?: () => void;
};

type NeedLoginContextValue = {
  openNeedLogin: (options?: NeedLoginOptions) => void;
  closeNeedLogin: () => void;
  isOpen: boolean;
};

const NeedLoginContext = React.createContext<NeedLoginContextValue | null>(null);

export function useNeedLogin() {
  const value = React.useContext(NeedLoginContext);
  if (!value) throw new Error('useNeedLogin must be used within NeedLoginProvider');
  return value;
}

export function NeedLoginProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const session = data as Session | null;

  const [isOpen, setIsOpen] = React.useState(false);
  const [options, setOptions] = React.useState<NeedLoginOptions | null>(null);
  const optionsRef = React.useRef<NeedLoginOptions | null>(null);
  const onSuccessRef = React.useRef<NeedLoginOptions['onSuccess'] | undefined>(undefined);
  const firedRef = React.useRef(false);

  const openNeedLogin = React.useCallback((next?: NeedLoginOptions) => {
    const resolved = next ?? {};
    setOptions(resolved);
    optionsRef.current = resolved;
    onSuccessRef.current = next?.onSuccess;
    firedRef.current = false;
    setIsOpen(true);
  }, []);

  const closeNeedLogin = React.useCallback(() => {
    optionsRef.current?.onDismiss?.();
    setIsOpen(false);
    setOptions(null);
    optionsRef.current = null;
    onSuccessRef.current = undefined;
  }, []);

  const isLoggedIn = Boolean(session?.session?.id);

  // If the visitor already signed in (e.g. after a rapid inline login), dismiss
  // the dialog and run the optional onSuccess exactly once.
  React.useEffect(() => {
    if (!isOpen) return;
    if (isLoggedIn) {
      if (onSuccessRef.current && !firedRef.current) {
        firedRef.current = true;
        const callback = onSuccessRef.current;
        onSuccessRef.current = undefined;
        setIsOpen(false);
        callback();
      } else {
        setIsOpen(false);
      }
    }
  }, [isOpen, isLoggedIn]);

  const value = React.useMemo<NeedLoginContextValue>(
    () => ({ openNeedLogin, closeNeedLogin, isOpen }),
    [openNeedLogin, closeNeedLogin, isOpen]
  );

  const returnTo =
    options?.returnTo ??
    (typeof window !== 'undefined' ? window.location.href : undefined);
  const loginHref = returnTo ? getStoreLoginUrl(returnTo) : getStoreLoginUrl();

  return (
    <NeedLoginContext.Provider value={value}>
      {children}
      <NeedLoginDialog
        open={isOpen}
        onClose={closeNeedLogin}
        title={options?.title ?? 'Log in to continue'}
        description={
          options?.description ??
          'Log in to your account to pick up where you left off. We’ll keep your wishlist and cart safe.'
        }
        loginHref={loginHref}
        isPending={isPending}
      />
    </NeedLoginContext.Provider>
  );
}

function goToLogin(href: string) {
  window.location.assign(href);
}

type NeedLoginDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  loginHref: string;
  isPending: boolean;
};




/**
 * Responsive login prompt — a centered Dialog on desktop, a bottom Drawer on
 * mobile (matching the app's existing wishlist picker behavior).
 */
function NeedLoginDialog({
  open,
  onClose,
  title,
  description,
  loginHref,
  isPending,
}: NeedLoginDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const loginDisabled = isPending;

  const actions = (
    <>
      <Button
        className="w-full bg-primary text-background hover:bg-primary/70 h-10"
        disabled={loginDisabled}
        onClick={() => goToLogin(loginHref)}
      >
        Log in
      </Button>
      <Button
        variant="outline"
        className="w-full rounded-none h-10"
        disabled={loginDisabled}
        onClick={() => goToLogin(loginHref)}
      >
        Create an account
      </Button>
    </>
  );

  const wholeContainer = (
    <div className="flex flex-col items-center justify-center">
      <Image src="/images/login-hero-2.webp" alt="Need login" width={1200} height={400} className="mx-auto my-4 rounded-[10px]" />
      <div className="grid w-full gap-2">{actions}</div>
    </div>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-start">
            {wholeContainer}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          {wholeContainer}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}