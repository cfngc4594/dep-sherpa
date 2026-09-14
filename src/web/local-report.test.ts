import { describe, expect, it } from 'vitest';
import { sampleIsolatedUpgradeReport, sampleRepairAttempt } from '../harness/report-fixture';
import {
  availabilityFromCapabilities,
  canRunLocally,
  classifyDiffLine,
  deriveLocalStages,
  formatElapsedParts,
  parseNdjsonBuffer,
  proposalSource,
} from './local-report';

describe('local availability', () => {
  it('treats a hosted deployment answer as unavailable with its reason', () => {
    expect(availabilityFromCapabilities({ enabled: false, reason: 'hosted_deployment' })).toEqual({ status: 'unavailable', reason: 'hosted_deployment' });
    expect(availabilityFromCapabilities({ enabled: false, reason: 'production_environment' })).toEqual({ status: 'unavailable', reason: 'production_environment' });
  });

  it('never enables local mode from a malformed or partial answer', () => {
    expect(availabilityFromCapabilities({ enabled: true })).toEqual({ status: 'unavailable', reason: 'hosted_deployment' });
    expect(availabilityFromCapabilities({ enabled: 'true', mode: 'local-harness' })).toEqual({ status: 'unavailable', reason: 'hosted_deployment' });
    expect(availabilityFromCapabilities({ enabled: false, reason: 'something-else' })).toEqual({ status: 'unavailable', reason: 'hosted_deployment' });
    expect(availabilityFromCapabilities(null)).toEqual({ status: 'unreachable' });
    expect(availabilityFromCapabilities({ error: { code: 'NOT_FOUND' } })).toEqual({ status: 'unreachable' });
    expect(canRunLocally({ status: 'unavailable', reason: 'hosted_deployment' })).toBe(false);
    expect(canRunLocally({ status: 'unreachable' })).toBe(false);
    expect(canRunLocally({ status: 'checking' })).toBe(false);
  });

  it('enables local mode only for a complete harness answer', () => {
    const capabilities = { enabled: true, mode: 'local-harness', keepWorkspaceAllowed: false, projectRoot: '/repo', proposalGenerator: 'none', policy: { maxFiles: 3, maxChangedLines: 12, allowedExtensions: [], forbiddenPathPatterns: [] }, executionModel: { disposableClone: true, installScriptsAllowed: false, externalWritesAllowed: false, operatingSystemSandbox: false } };
    const availability = availabilityFromCapabilities(capabilities);
    expect(availability.status).toBe('enabled');
    expect(canRunLocally(availability)).toBe(true);
  });
});

describe('stage derivation from the CLI report', () => {
  it('shows every stage as pending before a run and as running during one', () => {
    expect(deriveLocalStages({ status: 'idle' }).map((stage) => stage.state)).toEqual(Array(7).fill('pending'));
    expect(deriveLocalStages({ status: 'running', startedAt: 0, elapsedMs: 10 }).map((stage) => stage.state)).toEqual(Array(7).fill('running'));
  });

  it('derives stage outcomes from the report instead of inventing them', () => {
    const stages = deriveLocalStages({ status: 'ready', report: sampleIsolatedUpgradeReport(), markdown: '' });
    expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
      ['preparation', 'passed'],
      ['baseline', 'passed'],
      ['upgrade', 'passed'],
      ['candidate', 'failed'],
      ['proposal', 'passed'],
      ['policy', 'passed'],
      ['verification', 'passed'],
    ]);
    expect(stages[3]).toMatchObject({ detailKey: 'stageDetailIntroduced', values: { count: 2 } });
    expect(stages[4]).toMatchObject({ detailKey: 'stageDetailProposalRecipe', values: { id: 'zod-v4-errors-to-issues' } });
  });

  it('marks a policy rejection and skips verification when no edit was applied', () => {
    const report = sampleIsolatedUpgradeReport({
      verdict: 'needs_repair',
      repair: sampleRepairAttempt({ status: 'policy_rejected', rationale: 'src/validation.ts is inside a test path.', verificationResults: [], proposal: null, proposalSource: 'recipe' }),
    });
    const stages = deriveLocalStages({ status: 'ready', report, markdown: '' });
    expect(stages[4]).toMatchObject({ key: 'proposal', state: 'attention' });
    expect(stages[5]).toMatchObject({ key: 'policy', state: 'failed', values: { reason: 'src/validation.ts is inside a test path.' } });
    expect(stages[6]).toMatchObject({ key: 'verification', state: 'skipped' });
  });

  it('marks a blocked preparation and skipped downstream stages', () => {
    const report = sampleIsolatedUpgradeReport({
      verdict: 'blocked',
      preparation: { name: 'prepare_dependencies', command: 'npm ci', status: 'failed', exitCode: 1, durationMs: 50, output: 'ERESOLVE' },
      upgrade: { name: 'apply_upgrade', command: 'npm install zod@4.1.5', status: 'skipped', exitCode: null, durationMs: 0, output: 'Dependency preparation failed, so the upgrade was not attempted.' },
      baselineResults: [], candidateResults: [], comparisons: [], upgradeChangedFiles: [],
      repair: sampleRepairAttempt({ requested: false, status: 'not_requested', proposal: null, proposalSource: null, verificationResults: [] }),
    });
    const stages = deriveLocalStages({ status: 'ready', report, markdown: '' });
    expect(stages.map((stage) => stage.state)).toEqual(['failed', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(stages[2]).toMatchObject({ detailKey: 'stageDetailUpgradeSkipped' });
  });

  it('labels the proposal source without guessing', () => {
    expect(proposalSource(sampleRepairAttempt())).toBe('recipe');
    expect(proposalSource(sampleRepairAttempt({ proposal: { kind: 'agent', id: 'agent-1', summary: '', evidence: [], edits: [] }, proposalSource: 'agent' }))).toBe('agent');
    expect(proposalSource(sampleRepairAttempt({ proposal: null, proposalSource: null }))).toBe('none');
  });
});

describe('stream and diff helpers', () => {
  it('splits complete NDJSON lines from a partial tail', () => {
    const parsed = parseNdjsonBuffer('{"type":"accepted","startedAt":"x"}\n{"type":"heartbeat","elapsedMs":5}\n{"type":"rep');
    expect(parsed.events.map((event) => event.type)).toEqual(['accepted', 'heartbeat']);
    expect(parsed.rest).toBe('{"type":"rep');
    expect(parseNdjsonBuffer('garbage\n{"type":"nope"}\n').events).toEqual([]);
  });

  it('classifies diff lines for rendering', () => {
    expect(classifyDiffLine('diff --git a/x b/x')).toBe('meta');
    expect(classifyDiffLine('--- a/x')).toBe('meta');
    expect(classifyDiffLine('+++ b/x')).toBe('meta');
    expect(classifyDiffLine('@@ -1 +1 @@')).toBe('meta');
    expect(classifyDiffLine('+added')).toBe('add');
    expect(classifyDiffLine('-removed')).toBe('remove');
    expect(classifyDiffLine(' context')).toBe('context');
  });

  it('formats elapsed time into minutes and seconds', () => {
    expect(formatElapsedParts(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(formatElapsedParts(61_500)).toEqual({ minutes: 1, seconds: 1 });
  });
});
