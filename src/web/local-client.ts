import {
  localApiBasePath,
  type LocalApiError,
  type LocalUpgradeEvent,
  type LocalUpgradeRequestBody,
} from '../harness/contracts';
import { availabilityFromCapabilities, parseNdjsonBuffer, type LocalAvailability } from './local-report';

/**
 * Browser-side client for the local harness. It only ever talks to the
 * same-origin `/api/local/*` endpoints; it never touches the filesystem or a
 * shell itself.
 */

export class LocalApiRequestError extends Error {
  constructor(public readonly error: LocalApiError) {
    super(error.message);
    this.name = 'LocalApiRequestError';
  }
}

async function errorFromResponse(response: Response): Promise<LocalApiError> {
  try {
    const payload = await response.json() as { error?: Partial<LocalApiError> };
    if (payload.error && typeof payload.error.code === 'string') {
      return { code: payload.error.code, message: payload.error.message ?? '', reason: payload.error.reason } as LocalApiError;
    }
  } catch {
    // Fall through to a generic error.
  }
  return { code: 'RUN_FAILED', message: `The local harness answered with HTTP ${response.status}.` };
}

export async function fetchLocalAvailability(fetchImpl: typeof fetch = fetch): Promise<LocalAvailability> {
  try {
    const response = await fetchImpl(`${localApiBasePath}/capabilities`, { cache: 'no-store' });
    return availabilityFromCapabilities(await response.json());
  } catch {
    return { status: 'unreachable' };
  }
}

/**
 * Starts an isolated upgrade and forwards every streamed event. Resolves when
 * the stream ends; rejects with `LocalApiRequestError` when the harness refuses
 * the request before starting a run.
 */
export async function streamLocalUpgrade(
  body: LocalUpgradeRequestBody,
  onEvent: (event: LocalUpgradeEvent) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${localApiBasePath}/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/x-ndjson')) {
    throw new LocalApiRequestError(await errorFromResponse(response));
  }
  if (!response.body) throw new LocalApiRequestError({ code: 'RUN_FAILED', message: 'The harness returned no stream.' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseNdjsonBuffer(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
  buffer += decoder.decode();
  if (buffer.trim()) parseNdjsonBuffer(`${buffer}\n`).events.forEach(onEvent);
}
