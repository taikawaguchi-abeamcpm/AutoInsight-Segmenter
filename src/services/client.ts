import type { ApiError } from '../types/common';

const DEFAULT_DELAY_MS = 180;

export interface RequestOptions {
  signal?: AbortSignal;
}

interface ApiRequestOptions extends RequestInit {
  signal?: AbortSignal;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export const delay = (ms = DEFAULT_DELAY_MS, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request was aborted.', 'AbortError'));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);

    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Request was aborted.', 'AbortError'));
    };

    signal?.addEventListener('abort', abort, { once: true });
  });

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export const createApiError = ({
  code,
  message,
  severity = 'error',
  retryable = false,
  targetPath
}: Omit<Partial<ApiError>, 'correlationId'> & Pick<ApiError, 'code' | 'message'>): ApiError => ({
  code,
  message,
  severity,
  retryable,
  targetPath,
  correlationId: `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
});

export const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  'message' in error &&
  'correlationId' in error;

const readPayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => '');
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const apiRequest = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T | null> => {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return null;
  }

  if (response.status === 404) {
    return null;
  }

  const payload = await readPayload(response);

  if (!response.ok) {
    if (payload && isApiError(payload)) {
      throw payload;
    }

    throw createApiError({
      code: `HTTP.${response.status}`,
      message: response.statusText || 'API request failed.',
      retryable: response.status >= 500
    });
  }

  return payload as T;
};

export const makeHash = (value: unknown): string => {
  const source = JSON.stringify(value);
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
};
