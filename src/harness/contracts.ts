import type { ModelProvider } from '../agent/openai';
import type {
  InvestigationReport,
  IsolatedUpgradeReport,
  RepairPolicyLimits,
} from '../core/types';

/**
 * Wire contract shared by the local harness API, the hosted rejection routes,
 * and the browser. This module must stay free of Node-only imports because the
 * hosted Worker bundle and the client bundle both import it.
 */

export const localApiBasePath = '/api/local';

export type LocalExecutionUnavailableReason =
  /** A hosted or public deployment: no Node process and no harness middleware. */
  | 'hosted_deployment'
  /** A Node process running with NODE_ENV=production. */
  | 'production_environment'
  /** The developer disabled the harness with DEPSHERPA_LOCAL_HARNESS=0. */
  | 'harness_disabled'
  /** The request did not arrive over the loopback interface. */
  | 'non_loopback_request'
  /** The request came from a different browser origin. */
  | 'cross_origin_request';

export type LocalApiErrorCode =
  | 'LOCAL_EXECUTION_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'REPOSITORY_NOT_FOUND'
  | 'NOT_A_GIT_ROOT'
  | 'KEEP_WORKSPACE_NOT_ENABLED'
  | 'RUN_IN_PROGRESS'
  | 'RUN_FAILED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED';

export interface LocalApiError {
  code: LocalApiErrorCode;
  message: string;
  reason?: LocalExecutionUnavailableReason;
}

export interface LocalApiErrorBody {
  error: LocalApiError;
}

export interface LocalCapabilitiesEnabled {
  enabled: true;
  mode: 'local-harness';
  /** Only true when the harness process was started with DEPSHERPA_KEEP_WORKSPACE=1. */
  keepWorkspaceAllowed: boolean;
  /** The Git root the harness was started from; offered as a convenience default. */
  projectRoot: string | null;
  /** Which OpenAI-compatible endpoint (if any) the harness process would use for model proposals. */
  proposalGenerator: ModelProvider;
  policy: RepairPolicyLimits;
  executionModel: {
    disposableClone: true;
    installScriptsAllowed: false;
    externalWritesAllowed: false;
    operatingSystemSandbox: false;
  };
}

export interface LocalCapabilitiesUnavailable {
  enabled: false;
  reason: LocalExecutionUnavailableReason;
}

export type LocalCapabilitiesResponse = LocalCapabilitiesEnabled | LocalCapabilitiesUnavailable;

/** The only fields the local API accepts. Anything else is rejected. */
export interface LocalUpgradeRequestBody {
  repoPath: string;
  packageName: string;
  targetVersion: string;
  attemptRepair: boolean;
  keepWorkspace?: boolean;
}

export interface LocalInspectRequestBody {
  repoPath: string;
  packageName: string;
  targetVersion: string;
}

export interface LocalInspectResponse {
  report: InvestigationReport;
  markdown: string;
}

/** Newline-delimited JSON events streamed by POST /api/local/upgrade. */
export type LocalUpgradeEvent =
  | { type: 'accepted'; startedAt: string }
  | { type: 'heartbeat'; elapsedMs: number }
  | { type: 'report'; report: IsolatedUpgradeReport; markdown: string }
  | { type: 'error'; error: LocalApiError };

export function isLocalUpgradeEvent(value: unknown): value is LocalUpgradeEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const event = value as { type: unknown };
  return event.type === 'accepted' || event.type === 'heartbeat' || event.type === 'report' || event.type === 'error';
}
