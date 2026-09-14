import type { CommandResult, IsolatedUpgradeReport, RepairAttempt } from '../core/types';
import type {
  LocalApiError,
  LocalCapabilitiesEnabled,
  LocalExecutionUnavailableReason,
  LocalUpgradeEvent,
} from '../harness/contracts';
import { isLocalUpgradeEvent } from '../harness/contracts';
import type { MessageKey } from '../i18n/messages';

/**
 * Pure view-model helpers for the local upgrade console. They translate the
 * CLI's `IsolatedUpgradeReport` into stage states and labels without adding
 * any interpretation the report does not already contain.
 */

export type LocalAvailability =
  | { status: 'checking' }
  | { status: 'enabled'; capabilities: LocalCapabilitiesEnabled }
  | { status: 'unavailable'; reason: LocalExecutionUnavailableReason }
  | { status: 'unreachable' };

export type LocalRunState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; elapsedMs: number }
  | { status: 'ready'; report: IsolatedUpgradeReport; markdown: string }
  | { status: 'error'; error: LocalApiError };

const unavailableReasons: LocalExecutionUnavailableReason[] = [
  'hosted_deployment',
  'production_environment',
  'harness_disabled',
  'non_loopback_request',
  'cross_origin_request',
];

export function isUnavailableReason(value: unknown): value is LocalExecutionUnavailableReason {
  return typeof value === 'string' && (unavailableReasons as string[]).includes(value);
}

/** Maps the capabilities response body to a UI availability state. Anything malformed is treated as unavailable. */
export function availabilityFromCapabilities(body: unknown): LocalAvailability {
  if (!body || typeof body !== 'object' || !('enabled' in body)) return { status: 'unreachable' };
  const response = body as { enabled?: unknown; reason?: unknown; mode?: unknown };
  if (response.enabled === true && response.mode === 'local-harness') {
    return { status: 'enabled', capabilities: body as LocalCapabilitiesEnabled };
  }
  return { status: 'unavailable', reason: isUnavailableReason(response.reason) ? response.reason : 'hosted_deployment' };
}

export function canRunLocally(availability: LocalAvailability): availability is Extract<LocalAvailability, { status: 'enabled' }> {
  return availability.status === 'enabled';
}

export type LocalStageKey =
  | 'preparation'
  | 'baseline'
  | 'upgrade'
  | 'candidate'
  | 'proposal'
  | 'policy'
  | 'verification';

export type LocalStageState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'attention';

export interface LocalStageView {
  key: LocalStageKey;
  labelKey: MessageKey;
  state: LocalStageState;
  detailKey: MessageKey;
  values?: Record<string, string | number>;
}

export const localStageOrder: Array<{ key: LocalStageKey; labelKey: MessageKey }> = [
  { key: 'preparation', labelKey: 'stagePreparation' },
  { key: 'baseline', labelKey: 'stageBaseline' },
  { key: 'upgrade', labelKey: 'stageUpgradeLocal' },
  { key: 'candidate', labelKey: 'stageCandidate' },
  { key: 'proposal', labelKey: 'stageProposal' },
  { key: 'policy', labelKey: 'stagePolicy' },
  { key: 'verification', labelKey: 'stageVerification' },
];

function summarizeChecks(results: CommandResult[]) {
  const total = results.length;
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed' || result.status === 'timed_out').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  return { total, passed, failed, skipped };
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 100) / 10;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function proposalSource(repair: RepairAttempt): 'recipe' | 'agent' | 'none' {
  if (repair.proposal?.kind === 'agent' || repair.proposalSource === 'agent') return 'agent';
  if (repair.proposal?.kind === 'recipe' || repair.proposalSource === 'recipe') return 'recipe';
  return 'none';
}

export function deriveLocalStages(run: LocalRunState): LocalStageView[] {
  if (run.status !== 'ready') {
    const state: LocalStageState = run.status === 'running' ? 'running' : 'pending';
    const detailKey: MessageKey = run.status === 'running' ? 'stageRunningDetail' : 'stagePending';
    return localStageOrder.map((stage) => ({ ...stage, state, detailKey }));
  }
  const { report } = run;
  const commandState = (result: CommandResult): LocalStageState => (
    result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed'
  );
  const baseline = summarizeChecks(report.baselineResults);
  const candidate = summarizeChecks(report.candidateResults);
  const introduced = report.comparisons.filter((comparison) => comparison.state === 'introduced_failure').length;
  const repair = report.repair;
  const source = proposalSource(repair);
  const verification = summarizeChecks(repair.verificationResults);

  const preparation: LocalStageView = {
    key: 'preparation', labelKey: 'stagePreparation', state: commandState(report.preparation), detailKey: 'stageDetailCommand',
    values: { command: report.preparation.command, status: report.preparation.status, duration: formatDuration(report.preparation.durationMs) },
  };
  const baselineStage: LocalStageView = {
    key: 'baseline', labelKey: 'stageBaseline',
    state: baseline.total === baseline.skipped ? 'skipped' : baseline.failed ? 'attention' : 'passed',
    detailKey: 'stageDetailChecks', values: baseline,
  };
  const upgradeStage: LocalStageView = report.upgrade.status === 'passed'
    ? { key: 'upgrade', labelKey: 'stageUpgradeLocal', state: 'passed', detailKey: 'stageDetailUpgradeFiles', values: { count: report.upgradeChangedFiles.length } }
    : report.upgrade.status === 'skipped'
      ? { key: 'upgrade', labelKey: 'stageUpgradeLocal', state: 'skipped', detailKey: 'stageDetailUpgradeSkipped', values: { reason: report.upgrade.output } }
      : { key: 'upgrade', labelKey: 'stageUpgradeLocal', state: 'failed', detailKey: 'stageDetailCommand', values: { command: report.upgrade.command, status: report.upgrade.status, duration: formatDuration(report.upgrade.durationMs) } };
  const candidateStage: LocalStageView = candidate.total === candidate.skipped
    ? { key: 'candidate', labelKey: 'stageCandidate', state: 'skipped', detailKey: 'stageDetailChecks', values: candidate }
    : introduced
      ? { key: 'candidate', labelKey: 'stageCandidate', state: 'failed', detailKey: 'stageDetailIntroduced', values: { count: introduced } }
      : { key: 'candidate', labelKey: 'stageCandidate', state: candidate.failed ? 'attention' : 'passed', detailKey: 'stageDetailChecks', values: candidate };

  let proposalStage: LocalStageView;
  if (!repair.requested) {
    proposalStage = { key: 'proposal', labelKey: 'stageProposal', state: 'skipped', detailKey: 'stageDetailNotRequested' };
  } else if (repair.status === 'not_needed') {
    proposalStage = { key: 'proposal', labelKey: 'stageProposal', state: 'passed', detailKey: 'stageDetailNotNeeded' };
  } else if (repair.proposal && source === 'recipe') {
    proposalStage = { key: 'proposal', labelKey: 'stageProposal', state: 'passed', detailKey: 'stageDetailProposalRecipe', values: { id: repair.proposal.id } };
  } else if (repair.proposal && source === 'agent') {
    proposalStage = { key: 'proposal', labelKey: 'stageProposal', state: 'passed', detailKey: 'stageDetailProposalAgent', values: { id: repair.proposal.id } };
  } else {
    proposalStage = { key: 'proposal', labelKey: 'stageProposal', state: 'attention', detailKey: 'stageDetailProposalNone' };
  }

  const policyStage: LocalStageView = repair.status === 'policy_rejected'
    ? { key: 'policy', labelKey: 'stagePolicy', state: 'failed', detailKey: 'stageDetailPolicyRejected', values: { reason: repair.rationale } }
    : repair.status === 'verified' || repair.status === 'failed_verification'
      ? { key: 'policy', labelKey: 'stagePolicy', state: 'passed', detailKey: 'stageDetailPolicyAccepted' }
      : { key: 'policy', labelKey: 'stagePolicy', state: 'skipped', detailKey: 'stageDetailPolicySkipped' };

  const verificationStage: LocalStageView = repair.verificationResults.length
    ? { key: 'verification', labelKey: 'stageVerification', state: repair.status === 'verified' ? 'passed' : 'failed', detailKey: 'stageDetailVerification', values: verification }
    : { key: 'verification', labelKey: 'stageVerification', state: 'skipped', detailKey: 'stageDetailVerificationSkipped' };

  return [preparation, baselineStage, upgradeStage, candidateStage, proposalStage, policyStage, verificationStage];
}

export type DiffLineKind = 'add' | 'remove' | 'meta' | 'context';

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('@@')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

/** Splits a buffer of newline-delimited JSON into complete events and the unread remainder. */
export function parseNdjsonBuffer(buffer: string): { events: LocalUpgradeEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: LocalUpgradeEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isLocalUpgradeEvent(parsed)) events.push(parsed);
    } catch {
      // Ignore partial or malformed lines; the final report line is validated separately.
    }
  }
  return { events, rest };
}

export function formatElapsedParts(elapsedMs: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}
