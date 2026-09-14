import { describe, expect, it } from '@jest/globals';
import { renderIsolatedUpgradeReport, renderMarkdownReport } from '../../src/core/report.js';
import type { InvestigationReport, IsolatedUpgradeReport } from '../../src/core/types.js';

describe('report rendering', () => {
  it('keeps the human gate explicit', () => {
    const report: InvestigationReport = {
      generatedAt: '2026-09-02T00:00:00.000Z',
      repository: '@acme/checkout-ui',
      manifestPath: '/fixture/package.json',
      packageManager: 'pnpm',
      finding: {
        packageName: 'zod',
        section: 'dependencies',
        declaredRange: '^3.23.8',
        currentVersion: '3.23.8',
        targetVersion: '4.1.5',
        releaseType: 'major',
        risk: 'high',
        reasons: ['The target crosses a major-version boundary.'],
      },
      checks: [],
      results: [],
      externalWritesAllowed: false,
    };
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('DepSherpa external writes: **blocked**');
    expect(markdown).toContain('explicit human decision');
  });

  it('renders isolation, comparison, and patch evidence without implying an external write', () => {
    const command = {
      name: 'test',
      command: 'npm run test',
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 5,
      output: 'ok',
    };
    const report: IsolatedUpgradeReport = {
      mode: 'isolated-local',
      generatedAt: '2026-09-02T00:00:00.000Z',
      repository: 'sample',
      manifestPath: '/tmp/workspace/package.json',
      packageManager: 'npm',
      finding: {
        packageName: 'zod',
        section: 'dependencies',
        declaredRange: '4.5.3',
        currentVersion: '4.5.3',
        targetVersion: '4.5.4',
        releaseType: 'patch',
        risk: 'low',
        reasons: ['Patch change.'],
      },
      checks: [{ name: 'test', command: 'npm run test', available: true }],
      results: [command],
      externalWritesAllowed: false,
      source: { path: '/repo', gitHead: 'abc123', dirtyFilesIgnored: [] },
      workspace: { disposable: true, retained: false, path: null },
      preparation: { ...command, name: 'prepare_dependencies', command: 'npm ci' },
      upgrade: { ...command, name: 'apply_upgrade', command: 'npm install zod@4.5.4' },
      baselineResults: [command],
      baselineSideEffects: [],
      candidateResults: [command],
      workspaceChangesAfterChecks: [' M package.json'],
      unexpectedCandidateChanges: [],
      comparisons: [{ name: 'test', baseline: 'passed', candidate: 'passed', state: 'passed' }],
      upgradeChangedFiles: ['package.json'],
      upgradePatch: '-  "zod": "4.5.3"\n+  "zod": "4.5.4"',
      changedFiles: ['package.json'],
      patch: '-  "zod": "4.5.3"\n+  "zod": "4.5.4"',
      verdict: 'ready_for_review',
      repairSuggestions: [],
      repair: {
        requested: false,
        status: 'not_requested',
        recipeId: null,
        proposal: null,
        proposalSource: null,
        contextRead: [],
        releaseEvidence: [],
        rationale: 'Not requested.',
        evidence: [],
        changedFiles: [],
        changedLines: 0,
        patch: '',
        verificationResults: [],
        unexpectedChanges: [],
        policy: { maxFiles: 3, maxChangedLines: 12, allowedExtensions: ['.ts'], forbiddenPathPatterns: ['tests/'] },
      },
      installScriptsAllowed: false,
    };
    const markdown = renderIsolatedUpgradeReport(report);
    expect(markdown).toContain('disposable clone');
    expect(markdown).toContain('ready_for_review');
    expect(markdown).toContain('explicit human approval');
    expect(markdown).toContain('"zod": "4.5.4"');
  });
});
