/**
 * Consume the product-image host SSE stream used by publish + edit.
 *
 * Events:
 *   progress  { current, total, message }
 *   complete  { success: true, message, data }
 *   error     { success: false, code, message }
 */

export type HostProgressEvent = {
  current: number;
  total: number;
  message: string;
};

export type HostCompleteResult<T> = {
  success: true;
  message: string;
  data: T;
};

export class HostImagesError extends Error {
  code?: string;
  status: number;
  constructor(
    message: string,
    opts: { code?: string; status?: number } = {}
  ) {
    super(message);
    this.name = 'HostImagesError';
    this.code = opts.code;
    this.status = opts.status ?? 500;
  }
}

type SseEvent = { event: string; data: string };

function consumeSseBlocks(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: SseEvent[] = [];

  for (const block of parts) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;

    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''));
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function throwHostError(data: unknown, status: number): never {
  const body = (data ?? {}) as {
    success?: boolean;
    error?: string;
    message?: string;
    code?: string;
  };
  throw new HostImagesError(
    body.error || body.message || `Request failed (${status}).`,
    { code: body.code, status }
  );
}

export async function streamHostImages<T>(options: {
  url: string;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  onProgress?: (event: HostProgressEvent) => void;
}): Promise<HostCompleteResult<T>> {
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: options.method ?? 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream, application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      cache: 'no-store',
      signal: options.signal,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new HostImagesError(
      'Unable to reach the server. Please try again.',
      { status: 0, code: 'NETWORK_ERROR' }
    );
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok && !contentType.includes('text/event-stream')) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      throw new HostImagesError(
        `Request failed with status ${response.status}.`,
        { status: response.status }
      );
    }
    throwHostError(data, response.status);
  }

  if (contentType.includes('application/json')) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      throw new HostImagesError('Server returned an invalid response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
      });
    }
    const body = data as {
      success?: boolean;
      message?: string;
      data?: T;
      error?: string;
      code?: string;
    };
    if (!response.ok || body.success === false) {
      throwHostError(data, response.status);
    }
    return {
      success: true,
      message: body.message || 'Done.',
      data: body.data as T,
    };
  }

  if (!response.body) {
    throw new HostImagesError('The server closed the stream unexpectedly.', {
      status: response.status,
      code: 'STREAM_EMPTY',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: HostCompleteResult<T> | null = null;
  let streamError: HostImagesError | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const consumed = consumeSseBlocks(buffer);
      buffer = consumed.rest;

      for (const event of consumed.events) {
        if (event.event === 'ping') continue;

        let parsed: unknown = null;
        if (event.data) {
          try {
            parsed = JSON.parse(event.data);
          } catch {
            continue;
          }
        }

        if (event.event === 'progress') {
          if (!parsed || typeof parsed !== 'object') continue;
          const rec = parsed as {
            current?: unknown;
            total?: unknown;
            message?: unknown;
          };
          const current =
            typeof rec.current === 'number' && Number.isFinite(rec.current)
              ? rec.current
              : 0;
          const total =
            typeof rec.total === 'number' && Number.isFinite(rec.total)
              ? rec.total
              : 0;
          const message =
            typeof rec.message === 'string' ? rec.message : 'Uploading images…';
          options.onProgress?.({ current, total, message });
          continue;
        }

        if (event.event === 'complete') {
          if (!parsed || typeof parsed !== 'object') continue;
          const rec = parsed as {
            success?: unknown;
            message?: unknown;
            data?: T;
          };
          result = {
            success: true,
            message:
              typeof rec.message === 'string' ? rec.message : 'Done.',
            data: rec.data as T,
          };
          continue;
        }

        if (event.event === 'error') {
          const rec = (parsed ?? {}) as {
            code?: unknown;
            message?: unknown;
            error?: unknown;
          };
          const message =
            (typeof rec.message === 'string' && rec.message) ||
            (typeof rec.error === 'string' && rec.error) ||
            'Failed to upload product images.';
          streamError = new HostImagesError(message, {
            code: typeof rec.code === 'string' ? rec.code : undefined,
            status: response.status,
          });
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }

  if (streamError) throw streamError;
  if (!result) {
    throw new HostImagesError(
      'The upload finished without a confirmation. Please check the product before retrying.',
      { status: response.status, code: 'STREAM_INCOMPLETE' }
    );
  }
  return result;
}

export function isHostedProductImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const pathname = trimmed.startsWith('/')
      ? trimmed.split('?')[0] ?? trimmed
      : new URL(trimmed).pathname;
    const withoutServe = pathname.replace(/^\/api\/images(?=\/)/, '');
    return withoutServe.startsWith('/product/image/');
  } catch {
    return /\/product\/image\//.test(trimmed);
  }
}

export function optimisedPairUrl(fullUrl: string): string {
  return `${fullUrl}_op.avif`;
}
