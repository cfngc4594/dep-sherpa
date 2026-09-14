import type { LocalCapabilitiesResponse, LocalExecutionUnavailableReason } from './contracts';
import { detectExecutionContext, evaluateLocalExecutionGate, localExecutionUnavailableResponse } from './gate';

/**
 * Answers used by the Next.js route handlers under `app/api/local/*`.
 *
 * Those handlers run wherever the application is deployed: the Cloudflare
 * Worker behind a public Site, or any other server without the dev harness.
 * They import only this module and the pure gate, never the execution core, so
 * a hosted bundle physically cannot run an upgrade even if the gate were
 * misconfigured.
 */
export function hostedUnavailableReason(): LocalExecutionUnavailableReason {
  const decision = evaluateLocalExecutionGate(detectExecutionContext({ harnessAttached: false }));
  return decision.enabled ? 'hosted_deployment' : decision.reason;
}

export function hostedLocalExecutionRejection(): Response {
  return localExecutionUnavailableResponse(hostedUnavailableReason());
}

export function hostedLocalCapabilities(): Response {
  const body: LocalCapabilitiesResponse = { enabled: false, reason: hostedUnavailableReason() };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
