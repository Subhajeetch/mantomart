'use client';

import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';

type PayPalOrderData = {
  orderID: string;
};

export type PayPalActions = {
  restart: () => Promise<void>;
};

type PayPalButtonsInstance = {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
};

type PayPalButtonsOptions = {
  createOrder: () => Promise<string>;
  onClick: () => void;
  onApprove: (data: PayPalOrderData, actions: PayPalActions) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
  style: {
    layout: 'vertical';
    color: 'gold';
    shape: 'rect';
    label: 'paypal';
    height: number;
  };
};

type PayPalSdk = {
  Buttons: (options: PayPalButtonsOptions) => PayPalButtonsInstance;
};

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

let sdkPromise: Promise<void> | null = null;
let sdkClientId: string | null = null;

function loadPayPalSdk(clientId: string) {
  if (window.paypal) return Promise.resolve();
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;

  sdkClientId = clientId;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId,
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.dataset.mantomartPaypalSdk = 'true';
    script.onload = () => {
      if (window.paypal) resolve();
      else reject(new Error('PayPal checkout could not be loaded.'));
    };
    script.onerror = () => {
      script.remove();
      sdkPromise = null;
      sdkClientId = null;
      reject(new Error('PayPal checkout could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function PayPalButtons({
  clientId,
  createOrder,
  onApprove,
  onApprovalComplete,
  onCancel,
  onError,
}: {
  clientId: string;
  createOrder: () => Promise<string>;
  onApprove: (orderId: string, actions: PayPalActions) => Promise<void>;
  onApprovalComplete: () => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameObserverRef = useRef<MutationObserver | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ createOrder, onApprove, onApprovalComplete, onCancel, onError });
  const [loading, setLoading] = useState(true);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  callbacksRef.current = { createOrder, onApprove, onApprovalComplete, onCancel, onError };

  useEffect(() => {
    let disposed = false;
    let buttons: PayPalButtonsInstance | null = null;

    function finishOpeningCheckout() {
      if (!disposed) setOpeningCheckout(false);
      frameObserverRef.current?.disconnect();
      frameObserverRef.current = null;
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    function startOpeningCheckout() {
      finishOpeningCheckout();
      setOpeningCheckout(true);
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
        const top = window.scrollY + root.getBoundingClientRect().top - headerHeight - 16;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });

      const observedFrames = new WeakSet<HTMLIFrameElement>();
      const existingFrames = new Set(document.querySelectorAll('iframe'));
      const watchFrame = (frame: HTMLIFrameElement) => {
        if (existingFrames.has(frame)) return;
        const identity = `${frame.title} ${frame.getAttribute('src') ?? ''}`;
        if (!/paypal/i.test(identity) || observedFrames.has(frame)) return;
        observedFrames.add(frame);
        frame.addEventListener('load', finishOpeningCheckout, { once: true });
      };
      const watchNode = (node: Node) => {
        if (!(node instanceof Element)) return;
        if (node instanceof HTMLIFrameElement) watchFrame(node);
        node.querySelectorAll('iframe').forEach(watchFrame);
      };

      document.querySelectorAll('iframe').forEach(watchFrame);
      frameObserverRef.current = new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach(watchNode);
          if (record.target instanceof Element) {
            const frame = record.target.closest('iframe');
            if (frame) watchFrame(frame);
          }
        });
      });
      frameObserverRef.current.observe(document.body, {
        attributes: true,
        attributeFilter: ['src', 'title'],
        childList: true,
        subtree: true,
      });
      loadingTimeoutRef.current = setTimeout(finishOpeningCheckout, 6000);
    }

    void loadPayPalSdk(clientId)
      .then(() => {
        if (disposed || !containerRef.current || !window.paypal) return;
        buttons = window.paypal.Buttons({
          createOrder: () => callbacksRef.current.createOrder(),
          onClick: startOpeningCheckout,
          onApprove: async (data, actions) => {
            finishOpeningCheckout();
            await callbacksRef.current.onApprove(data.orderID, actions);
            approvalCompleteTimeoutRef.current = setTimeout(() => {
              callbacksRef.current.onApprovalComplete();
              approvalCompleteTimeoutRef.current = null;
            }, 700);
          },
          onCancel: () => {
            finishOpeningCheckout();
            callbacksRef.current.onCancel();
          },
          onError: (error) => {
            finishOpeningCheckout();
            console.error('PayPal checkout error:', error);
            callbacksRef.current.onError(error);
          },
          style: {
            layout: 'vertical',
            color: 'gold',
            shape: 'rect',
            label: 'paypal',
            height: 48,
          },
        });
        return buttons.render(containerRef.current);
      })
      .then(() => {
        if (!disposed) setLoading(false);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoading(false);
          finishOpeningCheckout();
          console.error('PayPal checkout error:', error);
          callbacksRef.current.onError(error);
        }
      });

    return () => {
      disposed = true;
      finishOpeningCheckout();
      if (approvalCompleteTimeoutRef.current) clearTimeout(approvalCompleteTimeoutRef.current);
      if (buttons) void buttons.close().catch(() => undefined);
    };
  }, [clientId]);

  return (
    <div ref={rootRef} className="relative z-10 mt-6 min-h-12 scroll-mt-28">
      {loading ? (
        <div className="flex min-h-12 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading secure PayPal checkout…
        </div>
      ) : null}
      <div ref={containerRef} className={loading ? 'pointer-events-none opacity-0' : ''} />
      {openingCheckout ? (
        <div role="status" aria-live="polite" className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Processing…
        </div>
      ) : null}
    </div>
  );
}
