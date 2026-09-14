import type { LocalApiErrorBody, LocalExecutionUnavailableReason } from './contracts';

/**
 * Environment gate for local command execution.
 *
 * Everything here is a pure function of an explicit context so the decision can
 * be unit-tested branch by branch. Nothing in this module imports Node-only
 * modules: the hosted Worker routes evaluate the same gate and must always land
 * on a rejection.
 */

export type ExecutionRuntime = 'node' | 'workerd' | 'unknown';

export interface LocalExecutionContext {
  /** Which JavaScript runtime is answering the request. */
  runtime: ExecutionRuntime;
  /** process.env.NODE_ENV, when the runtime exposes it. */
  nodeEnv: string | undefined;
  /** process.env.DEPSHERPA_LOCAL_HARNESS: an explicit developer kill switch. */
  harnessFlag: string | undefined;
  /**
   * True only when the request is being answered by the dev-server harness
   * middleware that has the deterministic core wired in. Next.js route
   * handlers never set this, so a hosted deployment can never pass the gate.
   */
  harnessAttached: boolean;
}

export type GateDecision =
  | { enabled: true }
  | { enabled: false; reason: LocalExecutionUnavailableReason };

const disabledFlagValues = new Set(['0', 'false', 'off', 'no', 'disabled']);

export function isHarnessFlagDisabled(flag: string | undefined): boolean {
  return flag !== undefined && disabledFlagValues.has(flag.trim().toLowerCase());
}

export function detectRuntime(globalObject: typeof globalThis = globalThis): ExecutionRuntime {
  const scope = globalObject as typeof globalThis & {
    navigator?: { userAgent?: string };
    WebSocketPair?: unknown;
    process?: { versions?: { node?: unknown }; release?: { name?: unknown } };
  };
  if (scope.navigator?.userAgent === 'Cloudflare-Workers' || typeof scope.WebSocketPair === 'function') {
    return 'workerd';
  }
  if (typeof scope.process?.versions?.node === 'string' && scope.process.release?.name === 'node') {
    return 'node';
  }
  return 'unknown';
}

export function detectExecutionContext(
  options: { harnessAttached: boolean; env?: Record<string, string | undefined>; globalObject?: typeof globalThis },
): LocalExecutionContext {
  const env = options.env ?? (typeof process !== 'undefined' && process.env ? process.env : {});
  return {
    runtime: detectRuntime(options.globalObject),
    nodeEnv: env.NODE_ENV,
    harnessFlag: env.DEPSHERPA_LOCAL_HARNESS,
    harnessAttached: options.harnessAttached,
  };
}

/** Environment-level decision. Safe by default: only an attached Node dev harness may pass. */
export function evaluateLocalExecutionGate(context: LocalExecutionContext): GateDecision {
  if (context.runtime !== 'node' || !context.harnessAttached) {
    return { enabled: false, reason: 'hosted_deployment' };
  }
  if (context.nodeEnv === 'production') {
    return { enabled: false, reason: 'production_environment' };
  }
  if (isHarnessFlagDisabled(context.harnessFlag)) {
    return { enabled: false, reason: 'harness_disabled' };
  }
  return { enabled: true };
}

const loopbackHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return loopbackHostnames.has(hostname.trim().toLowerCase().replace(/^\[|\]$/g, ''));
}

export function isLoopbackAddress(address: string | null | undefined): boolean {
  return Boolean(address) && loopbackAddresses.has(address!.trim().toLowerCase());
}

export interface LocalRequestFacts {
  /** Absolute URL the server reconstructed for the request. */
  url: string;
  /** Origin header, when the client sent one. */
  origin: string | null;
  /** Sec-Fetch-Site header, when the client sent one. */
  secFetchSite: string | null;
  /** Remote socket address, when the transport exposes one. */
  remoteAddress: string | null;
}

/** Request-level decision. Only loopback, same-origin traffic may reach the core. */
export function evaluateLocalRequest(facts: LocalRequestFacts): GateDecision {
  let url: URL;
  try {
    url = new URL(facts.url);
  } catch {
    return { enabled: false, reason: 'non_loopback_request' };
  }
  if (!isLoopbackHostname(url.hostname)) return { enabled: false, reason: 'non_loopback_request' };
  if (facts.remoteAddress !== null && !isLoopbackAddress(facts.remoteAddress)) {
    return { enabled: false, reason: 'non_loopback_request' };
  }
  if (facts.secFetchSite && facts.secFetchSite !== 'same-origin' && facts.secFetchSite !== 'none') {
    return { enabled: false, reason: 'cross_origin_request' };
  }
  if (facts.origin !== null && facts.origin !== 'null') {
    let origin: URL;
    try {
      origin = new URL(facts.origin);
    } catch {
      return { enabled: false, reason: 'cross_origin_request' };
    }
    if (origin.origin !== url.origin) return { enabled: false, reason: 'cross_origin_request' };
  } else if (facts.origin === 'null') {
    return { enabled: false, reason: 'cross_origin_request' };
  }
  return { enabled: true };
}

export function unavailableMessage(reason: LocalExecutionUnavailableReason): string {
  switch (reason) {
    case 'hosted_deployment':
      return 'This DepSherpa deployment is hosted and read-only. It never clones, installs, or executes repository code. Run `npm run dev` on your own machine to use the local isolated upgrade.';
    case 'production_environment':
      return 'Local execution is disabled because this server runs with NODE_ENV=production.';
    case 'harness_disabled':
      return 'The local harness was disabled with DEPSHERPA_LOCAL_HARNESS=0.';
    case 'non_loopback_request':
      return 'Local execution only answers requests from this machine over the loopback interface.';
    case 'cross_origin_request':
      return 'Local execution only answers same-origin requests from the DepSherpa page.';
  }
}

export function localExecutionUnavailableBody(reason: LocalExecutionUnavailableReason): LocalApiErrorBody {
  return { error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', message: unavailableMessage(reason), reason } };
}

export function localExecutionUnavailableResponse(reason: LocalExecutionUnavailableReason): Response {
  return Response.json(localExecutionUnavailableBody(reason), {
    status: 403,
    headers: { 'Cache-Control': 'no-store' },
  });
}
