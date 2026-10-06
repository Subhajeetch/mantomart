import { afterEach, describe, expect, it, vi } from 'vitest';
import type Env from '@/types/env';
import {
  MAX_ALIEXPRESS_REQUESTS_PER_HOSTING_INVOCATION,
  MAX_IMAGES_PER_HOSTING_INVOCATION,
  createAliExpressImageRateLimiter,
  createProductHostSseResponse,
  hostAliExpressOptimisedProductImages,
  hostProductImages,
  isHostedReviewImageUrl,
  resolveReviewImageUrlForClient,
} from '@/utils/images/productImageHost';

const imageUrl = 'https://ae01.alicdn.com/kf/sample.jpg';

function mockR2Put() {
  return vi.fn(async () => ({ etag: 'test-etag' }));
}

function mockR2Bucket(put: ReturnType<typeof mockR2Put>): R2Bucket {
  return { put } as unknown as R2Bucket;
}

function mockEnv(env: Pick<Env, 'API_URL' | 'R2_IMAGES'>): Env {
  return env as unknown as Env;
}

function createEnv(): Env {
  return mockEnv({
    API_URL: 'https://api.example.com',
    R2_IMAGES: mockR2Bucket(mockR2Put()),
  });
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
  it('starts AliExpress requests no faster than four per second', async () => {
    const limit = createAliExpressImageRateLimiter();
    const startedAt: number[] = [];

    await Promise.all(
      Array.from({ length: 3 }, async () => {
        await limit();
        startedAt.push(Date.now());
      })
    );

    startedAt.sort((a, b) => a - b);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(250);
    expect(startedAt[2]! - startedAt[1]!).toBeGreaterThanOrEqual(250);
  });

  it('keeps image batches and AliExpress requests within the 45-request budget', () => {
    expect(MAX_IMAGES_PER_HOSTING_INVOCATION).toBe(45);
    expect(MAX_ALIEXPRESS_REQUESTS_PER_HOSTING_INVOCATION).toBe(45);
  });

  it('rejects AliExpress requests once the per-invocation budget is exhausted', async () => {
    const limit = createAliExpressImageRateLimiter(0, 2);

    await limit();
    await limit();
    await expect(limit()).rejects.toMatchObject({
      code: 'ALIEXPRESS_REQUEST_BUDGET_EXCEEDED',
    });
  });

  it('creates optimised copies only for explicitly selected gallery images', async () => {
    const put = mockR2Put();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'Content-Type': 'image/avif' },
          })
      )
    );
    const firstUrl = 'https://ae01.alicdn.com/kf/first.jpg';
    const secondUrl = 'https://ae01.alicdn.com/kf/second.jpg';
    const result = await hostProductImages({
      ...hostInput(mockEnv({
        API_URL: 'https://api.example.com',
        R2_IMAGES: mockR2Bucket(put),
      })),
      productImages: [{ url: firstUrl }, { url: secondUrl }],
      optimisedImageUrls: [firstUrl],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.optimisedCount).toBe(1);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('stores optimized product-card images beside the full image with the _op suffix', async () => {
    const put = mockR2Put();
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/avif' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await hostAliExpressOptimisedProductImages({
      env: mockEnv({
        API_URL: 'https://api.example.com',
        R2_IMAGES: mockR2Bucket(put),
      }),
      images: [
        {
          sourceUrl: imageUrl,
          fullImagePath: '/product/image/sample.avif',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images[0]?.optimisedImagePath).toBe(
      '/product/image/sample.avif_op.avif'
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://ae01.alicdn.com/kf/sample.jpg_220x220.jpg_.avif'
    );
    expect(put).toHaveBeenCalledWith(
      'product/image/sample.avif_op.avif',
      expect.any(ArrayBuffer),
      expect.any(Object)
    );
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
    const fetchMock = vi.fn<typeof fetch>(
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

  it('recognizes review images only on the configured object host', () => {
    const env = mockEnv({
      API_URL: 'https://api.example.com',
    });

    expect(
      isHostedReviewImageUrl(
        'https://api.example.com/api/images/user/reviews/test.webp',
        env
      )
    ).toBe(true);
    expect(
      isHostedReviewImageUrl(
        'https://attacker.example/api/images/user/reviews/test.webp',
        env
      )
    ).toBe(false);
  });

  it('resolves stored relative review image paths to public object URLs', () => {
    const env = mockEnv({
      API_URL: 'https://api.example.com',
    });

    expect(
      resolveReviewImageUrlForClient('/user/reviews/test.webp', env)
    ).toBe('https://api.example.com/api/images/user/reviews/test.webp');
    expect(
      resolveReviewImageUrlForClient('/api/images/user/reviews/test.webp', env)
    ).toBe('https://api.example.com/api/images/user/reviews/test.webp');
    expect(
      resolveReviewImageUrlForClient(
        'https://cdn.example.com/user/reviews/test.webp',
        env
      )
    ).toBe('https://cdn.example.com/user/reviews/test.webp');
    expect(
      resolveReviewImageUrlForClient('/user/reviews/../private.webp', env)
    ).toBe('/user/reviews/../private.webp');
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
