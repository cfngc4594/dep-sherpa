import type { CommandResult, IsolatedUpgradeReport, RepairAttempt } from '../core/types';

/**
 * A compact, realistic `IsolatedUpgradeReport` used by harness and UI tests.
 * It mirrors the shape produced by `upgradeInIsolation` for the Zod recipe
 * demonstration so tests never need npm, Git, or network access.
 */

function result(name: string, status: CommandResult['status'], output = ''): CommandResult {
  return {
    name,
    command: `npm run ${name}`,
    status,
    exitCode: status === 'passed' ? 0 : status === 'skipped' ? null : 1,
    durationMs: 120,
    output,
  };
}

const typecheckFailure = "src/validation.ts(4,16): error TS2339: Property 'errors' does not exist on type 'ZodError<unknown>'.";

export function sampleRepairAttempt(overrides: Partial<RepairAttempt> = {}): RepairAttempt {
  return {
    requested: true,
    status: 'verified',
    recipeId: 'zod-v4-errors-to-issues',
    proposalSource: 'recipe',
    proposal: {
      kind: 'recipe',
      id: 'zod-v4-errors-to-issues',
      summary: 'Replace compiler-attributed Zod v3 error access with the Zod v4 API.',
      evidence: ['https://zod.dev/v4/changelog', typecheckFailure],
      edits: [{
        path: 'src/validation.ts',
        expectedText: '  return error.errors.map((issue) => issue.message);',
        replacement: '  return error.issues.map((issue) => issue.message);',
        rationale: 'Zod v4 exposes validation issues through ZodError.issues instead of ZodError.errors.',
        diagnostic: typecheckFailure,
      }],
    },
    contextRead: [{
      path: 'src/validation.ts',
      startLine: 1,
      endLine: 6,
      content: "import { ZodError } from 'zod';\n\nexport function format(error: ZodError) {\n  return error.errors.map((issue) => issue.message);\n}\n",
      diagnostic: typecheckFailure,
    }],
    releaseEvidence: ['Requested exact target: zod@4.1.5.', 'Installed package manifest: installed=zod@4.1.5; homepage=https://zod.dev.'],
    rationale: 'The recipe-generated Zod proposal passed every declared repository check.',
    evidence: ['https://zod.dev/v4/changelog', typecheckFailure],
    changedFiles: ['package-lock.json', 'package.json', 'src/validation.ts'],
    changedLines: 1,
    patch: [
      'diff --git a/src/validation.ts b/src/validation.ts',
      'index 1111111..2222222 100644',
      '--- a/src/validation.ts',
      '+++ b/src/validation.ts',
      '@@ -1,5 +1,5 @@',
      " import { ZodError } from 'zod';",
      ' export function format(error: ZodError) {',
      '-  return error.errors.map((issue) => issue.message);',
      '+  return error.issues.map((issue) => issue.message);',
      ' }',
    ].join('\n'),
    verificationResults: [result('lint', 'passed'), result('typecheck', 'passed'), result('test', 'passed'), result('build', 'passed')],
    unexpectedChanges: [],
    policy: {
      maxFiles: 3,
      maxChangedLines: 12,
      allowedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
      forbiddenPathPatterns: ['test/', 'tests/', 'fixtures/'],
    },
    ...overrides,
  };
}

export function sampleIsolatedUpgradeReport(overrides: Partial<IsolatedUpgradeReport> = {}): IsolatedUpgradeReport {
  const repair = overrides.repair ?? sampleRepairAttempt();
  return {
    mode: 'isolated-local',
    generatedAt: '2026-09-14T06:29:26.150Z',
    repository: 'depsherpa-zod-repair-demo',
    manifestPath: '/tmp/depsherpa-clone/workspace/package.json',
    packageManager: 'npm',
    finding: {
      packageName: 'zod',
      section: 'dependencies',
      declaredRange: '3.23.8',
      currentVersion: '3.23.8',
      targetVersion: '4.1.5',
      releaseType: 'major',
      risk: 'high',
      reasons: ['The target crosses a major-version boundary.'],
    },
    checks: ['lint', 'typecheck', 'test', 'build'].map((name) => ({ name, command: `npm run ${name}`, available: true })),
    results: repair.verificationResults,
    externalWritesAllowed: false,
    source: { path: '/Users/sample/projects/checkout', gitHead: 'cdd613954d4f9b2a32d6667b441d9456ef73f46f', dirtyFilesIgnored: [] },
    workspace: { disposable: true, retained: false, path: null },
    preparation: { name: 'prepare_dependencies', command: 'npm ci --ignore-scripts --no-audit --no-fund', status: 'passed', exitCode: 0, durationMs: 647, output: '' },
    upgrade: { name: 'apply_upgrade', command: 'npm install --ignore-scripts --no-audit --no-fund --save-exact zod@4.1.5', status: 'passed', exitCode: 0, durationMs: 900, output: '' },
    baselineResults: [result('lint', 'passed'), result('typecheck', 'passed'), result('test', 'passed'), result('build', 'passed')],
    baselineSideEffects: [],
    candidateResults: [result('lint', 'passed'), result('typecheck', 'failed', typecheckFailure), result('test', 'passed'), result('build', 'failed', typecheckFailure)],
    workspaceChangesAfterChecks: [' M package-lock.json', ' M package.json'],
    unexpectedCandidateChanges: [],
    comparisons: [
      { name: 'lint', baseline: 'passed', candidate: 'passed', state: 'passed' },
      { name: 'typecheck', baseline: 'passed', candidate: 'failed', state: 'introduced_failure' },
      { name: 'test', baseline: 'passed', candidate: 'passed', state: 'passed' },
      { name: 'build', baseline: 'passed', candidate: 'failed', state: 'introduced_failure' },
    ],
    upgradeChangedFiles: ['package-lock.json', 'package.json'],
    upgradePatch: 'diff --git a/package.json b/package.json\n-    "zod": "3.23.8"\n+    "zod": "4.1.5"',
    changedFiles: repair.changedFiles,
    patch: repair.patch,
    verdict: 'repaired_ready_for_review',
    repairSuggestions: [
      { check: 'typecheck', classification: 'introduced_failure', summary: 'The upgrade introduced a typecheck failure.', nextAction: 'Start with the first compiler diagnostic.', evidence: typecheckFailure },
      { check: 'build', classification: 'introduced_failure', summary: 'The upgrade introduced a build failure.', nextAction: 'Trace the earliest build error.', evidence: typecheckFailure },
    ],
    repair,
    installScriptsAllowed: false,
    ...overrides,
  };
}
