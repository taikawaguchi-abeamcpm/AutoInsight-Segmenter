import type { ApiError } from '../types/common';

const DEFAULT_DELAY_MS = 180;

export interface RequestOptions {
  signal?: AbortSignal;
}

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

export const makeHash = (value: unknown): string => {
  const source = JSON.stringify(value);
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
};
