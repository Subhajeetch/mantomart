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
  onCancel,
  onError,
}: {
  clientId: string;
  createOrder: () => Promise<string>;
  onApprove: (orderId: string, actions: PayPalActions) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ createOrder, onApprove, onCancel, onError });
  const [loading, setLoading] = useState(true);
  callbacksRef.current = { createOrder, onApprove, onCancel, onError };

  useEffect(() => {
    let disposed = false;
    let buttons: PayPalButtonsInstance | null = null;

    void loadPayPalSdk(clientId)
      .then(() => {
        if (disposed || !containerRef.current || !window.paypal) return;
        buttons = window.paypal.Buttons({
          createOrder: () => callbacksRef.current.createOrder(),
          onApprove: (data, actions) => callbacksRef.current.onApprove(data.orderID, actions),
          onCancel: () => callbacksRef.current.onCancel(),
          onError: (error) => {
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
          console.error('PayPal checkout error:', error);
          callbacksRef.current.onError(error);
        }
      });

    return () => {
      disposed = true;
      if (buttons) void buttons.close().catch(() => undefined);
    };
  }, [clientId]);

  return (
    <div className="mt-6 min-h-12">
      {loading ? (
        <div className="flex min-h-12 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading secure PayPal checkout…
        </div>
      ) : null}
      <div ref={containerRef} className={loading ? 'pointer-events-none opacity-0' : ''} />
    </div>
  );
}
