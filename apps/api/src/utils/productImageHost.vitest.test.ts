import { afterEach, describe, expect, it, vi } from 'vitest';
import type Env from '@/types/env';
import {
  createAliExpressImageRateLimiter,
  createProductHostSseResponse,
  hostProductImages,
} from '@/utils/productImageHost';

const imageUrl = 'https://ae01.alicdn.com/kf/sample.jpg';

function createEnv(): Env {
  return {
    API_URL: 'https://api.example.com',
    R2_IMAGES: {
      put: vi.fn(async () => ({ etag: 'test-etag' })),
    },
  } as Env;
}

function hostInput(env: Env) {
  return {
    env,
    slug: 'test-product',
    productImages: [{ url: imageUrl, isOp: true }],
    skuImages: [],
    propertyImages: [],
    sizeChartImage: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('product image hosting', () => {
  it('starts AliExpress requests no faster than two per second', async () => {
    const limit = createAliExpressImageRateLimiter();
    const startedAt: number[] = [];

    await Promise.all(
      Array.from({ length: 3 }, async () => {
        await limit();
        startedAt.push(Date.now());
      })
    );

    startedAt.sort((a, b) => a - b);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(500);
    expect(startedAt[2]! - startedAt[1]!).toBeGreaterThanOrEqual(500);
  });

  it('retries transient download failures up to three times', async () => {
    let requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        requests += 1;
        if (requests <= 3)
          return new Response('temporarily unavailable', { status: 503 });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/avif' },
        });
      })
    );

    const result = await hostProductImages(hostInput(createEnv()));

    expect(result.ok).toBe(true);
    expect(requests).toBe(4);
  });

  it('reports the source URL and does not retry a permanent HTTP failure', async () => {
    const fetchMock = vi.fn(
      async () => new Response('not found', { status: 404 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await hostProductImages(hostInput(createEnv()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('IMAGE_FETCH_FAILED');
    expect(result.error.message).toContain(imageUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the SSE connection alive until the upload work completes', async () => {
    vi.useFakeTimers();
    let finishUpload!: () => void;
    const uploadInProgress = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    const response = createProductHostSseResponse(
      new Request('https://api.example.com/products/mylist'),
      async () => uploadInProgress
    );
    const reader = response.body!.getReader();

    const connected = await reader.read();
    expect(new TextDecoder().decode(connected.value)).toContain(': connected');

    const heartbeatRead = reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    const heartbeat = await heartbeatRead;
    expect(new TextDecoder().decode(heartbeat.value)).toContain('event: ping');

    finishUpload();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});
