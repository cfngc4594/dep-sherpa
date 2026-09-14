import type { ModelProvider } from '../agent/openai';
import type { InvestigationOptions } from '../core/investigate';
import { getRepairCapabilities } from '../core/repair';
import { renderIsolatedUpgradeReport, renderMarkdownReport } from '../core/report';
import type { InvestigationReport, IsolatedUpgradeReport } from '../core/types';
import type { IsolatedUpgradeOptions } from '../core/upgrade';
import {
  localApiBasePath,
  type LocalApiError,
  type LocalCapabilitiesResponse,
  type LocalUpgradeEvent,
} from './contracts';
import { evaluateLocalRequest, localExecutionUnavailableResponse, type GateDecision } from './gate';
import { parseLocalInspectRequest, parseLocalUpgradeRequest } from './request';
import type { RepositoryValidation } from './repository';

/**
 * The local API handler is written against the Web `Request`/`Response` types
 * so the same code can be exercised by unit tests, by the dev-server harness
 * middleware, and (in principle) by any Node HTTP adapter. It performs no
 * execution of its own: every run goes through the injected deterministic core
 * functions, and every input is validated before those functions are reached.
 */

export interface LocalApiConnection {
  remoteAddress: string | null;
}

export type LocalApiHandler = (request: Request, connection?: LocalApiConnection) => Promise<Response>;

export interface LocalApiDependencies {
  /** Environment-level gate evaluated on every request. */
  gate: () => GateDecision;
  /** The CLI's isolated upgrade: `upgradeInIsolation` from `src/core/upgrade`. */
  upgrade: (options: IsolatedUpgradeOptions) => Promise<IsolatedUpgradeReport>;
  /** The CLI's dry-run inspection: `investigate` from `src/core/investigate`. */
  inspect: (options: InvestigationOptions) => Promise<InvestigationReport>;
  /** Filesystem + Git root confirmation for the supplied path. */
  validateRepository: (repoPath: string) => Promise<RepositoryValidation>;
  keepWorkspaceAllowed: boolean;
  projectRoot: string | null;
  /** Reported to the browser only; the core reads the same environment when it generates proposals. */
  modelProvider?: ModelProvider;
  timeoutMs?: number;
  heartbeatMs?: number;
  now?: () => number;
}

export const maxLocalRequestBytes = 64 * 1024;

const jsonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function errorResponse(error: LocalApiError, status: number, extraHeaders: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 800 ? `${message.slice(0, 797)}…` : message;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return {
      ok: false,
      response: errorResponse({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send the request as application/json.' }, 415),
    };
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxLocalRequestBytes) {
    return { ok: false, response: errorResponse({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' }, 413) };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse({ code: 'INVALID_INPUT', message: 'The request body could not be read.' }, 400) };
  }
  if (text.length > maxLocalRequestBytes) {
    return { ok: false, response: errorResponse({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' }, 413) };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: errorResponse({ code: 'INVALID_INPUT', message: 'Send a valid JSON request body.' }, 400) };
  }
}

function ndjsonResponse(
  run: (emit: (event: LocalUpgradeEvent) => void) => Promise<void>,
  options: { heartbeatMs: number; now: () => number },
): Response {
  const encoder = new TextEncoder();
  const startedAt = options.now();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: LocalUpgradeEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const finish = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      emit({ type: 'accepted', startedAt: new Date(startedAt).toISOString() });
      heartbeat = setInterval(() => emit({ type: 'heartbeat', elapsedMs: options.now() - startedAt }), options.heartbeatMs);
      run(emit).then(finish, (error) => {
        emit({ type: 'error', error: { code: 'RUN_FAILED', message: boundedMessage(error) } });
        finish();
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { ...jsonHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  });
}

export function createLocalApiHandler(deps: LocalApiDependencies): LocalApiHandler {
  const heartbeatMs = deps.heartbeatMs ?? 5_000;
  const now = deps.now ?? (() => Date.now());
  let activeRun: { startedAt: number } | null = null;

  const capabilities = (): LocalCapabilitiesResponse => ({
    enabled: true,
    mode: 'local-harness',
    keepWorkspaceAllowed: deps.keepWorkspaceAllowed,
    projectRoot: deps.projectRoot,
    proposalGenerator: deps.modelProvider ?? 'none',
    policy: getRepairCapabilities().policy,
    executionModel: {
      disposableClone: true,
      installScriptsAllowed: false,
      externalWritesAllowed: false,
      operatingSystemSandbox: false,
    },
  });

  return async (request, connection) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return errorResponse({ code: 'INVALID_INPUT', message: 'The request URL could not be parsed.' }, 400);
    }
    const route = url.pathname.startsWith(`${localApiBasePath}/`) ? url.pathname.slice(localApiBasePath.length + 1) : null;
    if (route !== 'capabilities' && route !== 'inspect' && route !== 'upgrade') {
      return errorResponse({ code: 'NOT_FOUND', message: 'Unknown local API route.' }, 404);
    }

    const environment = deps.gate();
    const decision: GateDecision = environment.enabled
      ? evaluateLocalRequest({
          url: url.toString(),
          origin: request.headers.get('origin'),
          secFetchSite: request.headers.get('sec-fetch-site'),
          remoteAddress: connection?.remoteAddress ?? null,
        })
      : environment;

    if (route === 'capabilities') {
      if (request.method !== 'GET') {
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Use GET for capabilities.' }, 405, { Allow: 'GET' });
      }
      const body: LocalCapabilitiesResponse = decision.enabled ? capabilities() : { enabled: false, reason: decision.reason };
      return Response.json(body, { headers: jsonHeaders });
    }

    if (!decision.enabled) return localExecutionUnavailableResponse(decision.reason);
    if (request.method !== 'POST') {
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: `Use POST for ${route}.` }, 405, { Allow: 'POST' });
    }
    const json = await readJsonBody(request);
    if (!json.ok) return json.response;

    if (route === 'inspect') {
      const parsed = parseLocalInspectRequest(json.body);
      if (!parsed.ok) return errorResponse(parsed.error, 400);
      const repository = await deps.validateRepository(parsed.value.repoPath);
      if (!repository.ok) return errorResponse(repository.error, 400);
      try {
        const report = await deps.inspect({
          repoPath: repository.path,
          packageName: parsed.value.packageName,
          targetVersion: parsed.value.targetVersion,
          runProjectChecks: false,
          timeoutMs: deps.timeoutMs,
        });
        return Response.json({ report, markdown: renderMarkdownReport(report) }, { headers: jsonHeaders });
      } catch (error) {
        return errorResponse({ code: 'RUN_FAILED', message: boundedMessage(error) }, 422);
      }
    }

    const parsed = parseLocalUpgradeRequest(json.body, { keepWorkspaceAllowed: deps.keepWorkspaceAllowed });
    if (!parsed.ok) return errorResponse(parsed.error, 400);
    const repository = await deps.validateRepository(parsed.value.repoPath);
    if (!repository.ok) return errorResponse(repository.error, 400);
    if (activeRun) {
      return errorResponse({
        code: 'RUN_IN_PROGRESS',
        message: 'An isolated upgrade is already running on this harness. Wait for it to finish before starting another.',
      }, 409);
    }
    activeRun = { startedAt: now() };
    const options: IsolatedUpgradeOptions = {
      repoPath: repository.path,
      packageName: parsed.value.packageName,
      targetVersion: parsed.value.targetVersion,
      attemptRepair: parsed.value.attemptRepair,
      keepWorkspace: parsed.value.keepWorkspace && deps.keepWorkspaceAllowed,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    };
    return ndjsonResponse(async (emit) => {
      try {
        const report = await deps.upgrade(options);
        emit({ type: 'report', report, markdown: renderIsolatedUpgradeReport(report) });
      } finally {
        activeRun = null;
      }
    }, { heartbeatMs, now });
  };
}
