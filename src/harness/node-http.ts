import type { IncomingMessage, ServerResponse } from 'node:http';
import { localApiBasePath } from './contracts';
import { maxLocalRequestBytes, type LocalApiHandler } from './api';

/**
 * Adapts Node's HTTP primitives to the Web `Request`/`Response` handler. The
 * adapter only answers `/api/local/*`; every other request is passed to the
 * next middleware untouched so the Next.js application keeps working.
 */

export type NodeMiddleware = (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void;

export function isLocalApiPath(url: string | undefined): boolean {
  if (!url) return false;
  const pathname = url.split('?')[0];
  return pathname === localApiBasePath || pathname.startsWith(`${localApiBasePath}/`);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else headers.set(name, value);
  }
  return headers;
}

async function readBody(request: IncomingMessage): Promise<{ ok: true; body: Buffer } | { ok: false }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxLocalRequestBytes) return { ok: false };
    chunks.push(buffer);
  }
  return { ok: true, body: Buffer.concat(chunks) };
}

export function toWebRequest(request: IncomingMessage, body: Buffer | null, options: { secure: boolean }): Request {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? '/', `${options.secure ? 'https' : 'http'}://${host}`);
  const method = request.method ?? 'GET';
  return new Request(url, {
    method,
    headers: requestHeaders(request),
    body: body && method !== 'GET' && method !== 'HEAD' ? new Uint8Array(body) : undefined,
  });
}

export async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  if (typeof target.flushHeaders === 'function') target.flushHeaders();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (target.destroyed) {
        await reader.cancel();
        return;
      }
      target.write(value);
    }
  } finally {
    target.end();
  }
}

export function createLocalHarnessMiddleware(
  handler: LocalApiHandler,
  options: { secure?: boolean } = {},
): NodeMiddleware {
  return (request, response, next) => {
    if (!isLocalApiPath(request.url)) {
      next();
      return;
    }
    void (async () => {
      const method = request.method ?? 'GET';
      const body = method === 'GET' || method === 'HEAD' ? { ok: true as const, body: null } : await readBody(request);
      if (!body.ok) {
        response.statusCode = 413;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' } }));
        return;
      }
      const webRequest = toWebRequest(request, body.body, { secure: Boolean(options.secure) });
      const webResponse = await handler(webRequest, { remoteAddress: request.socket?.remoteAddress ?? null });
      await writeWebResponse(webResponse, response);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({
        error: { code: 'RUN_FAILED', message: error instanceof Error ? error.message : 'The local harness failed to answer.' },
      }));
    });
  };
}
