import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  extractCacheTimeDiagnostics,
  extractZodErrorsDiagnostics,
  attemptBoundedRepair,
  getRepairCapabilities,
  planTanstackQueryGcTimeRepair,
  planZodIssuesRepair,
  validateRepairProposal,
} from '../../src/core/repair.js';
import type {
  CommandResult,
  DependencyFinding,
  RepairInvestigationContext,
  RepairProposal,
} from '../../src/core/types.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function failedTypecheck(file = 'src/validation.ts'): CommandResult {
  return {
    name: 'typecheck',
    command: 'npm run typecheck',
    status: 'failed',
    exitCode: 2,
    durationMs: 10,
    output: `${file}(4,16): error TS2339: Property 'errors' does not exist on type 'ZodError<unknown>'.`,
  };
}

const finding: DependencyFinding = {
  packageName: 'zod',
  section: 'dependencies',
  declaredRange: '^3.23.8',
  currentVersion: '3.23.8',
  targetVersion: '4.1.5',
  releaseType: 'major',
  risk: 'high',
  reasons: ['The target crosses a major-version boundary.'],
};

const queryFinding: DependencyFinding = {
  packageName: '@tanstack/react-query',
  section: 'dependencies',
  declaredRange: '^4.36.1',
  currentVersion: '4.36.1',
  targetVersion: '5.62.0',
  releaseType: 'major',
  risk: 'high',
  reasons: ['The target crosses a major-version boundary.'],
};

async function sourceRepository(filePath: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'depsherpa-repair-test-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, path.dirname(filePath)), { recursive: true });
  await writeFile(
    path.join(root, filePath),
    [
      "import { ZodError } from 'zod';",
      '',
      'export function format(error: ZodError) {',
      '  return error.errors.map(String);',
      '}',
    ].join('\n'),
  );
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', filePath], { cwd: root });
  return root;
}

async function querySourceRepository(filePath: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'depsherpa-repair-test-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, path.dirname(filePath)), { recursive: true });
  await writeFile(
    path.join(root, filePath),
    [
      "import { useQuery } from '@tanstack/react-query';",
      '',
      'export function useProfile() {',
      "  return useQuery({ queryKey: ['profile'], queryFn: async () => null, cacheTime: 60_000 });",
      '}',
    ].join('\n'),
  );
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', filePath], { cwd: root });
  return root;
}

describe('bounded source repair', () => {
  it('extracts only compiler-attributed errors-property diagnostics', () => {
    expect(extractZodErrorsDiagnostics([failedTypecheck()])).toEqual([
      {
        path: 'src/validation.ts',
        line: 4,
        evidence:
          "src/validation.ts(4,16): error TS2339: Property 'errors' does not exist on type 'ZodError<unknown>'.",
      },
    ]);
  });

  it('plans the documented Zod v4 property repair on the exact failing line', async () => {
    const root = await sourceRepository('src/validation.ts');
    const plan = await planZodIssuesRepair(root, finding, [failedTypecheck()]);
    expect(plan.rejectedReason).toBeNull();
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].changedLines).toBe(1);
    expect(plan.edits[0].updated).toContain('error.issues.map(String)');
    expect(plan.edits[0].updated).not.toContain('error.errors');
  });

  it('rejects changes to test files even when the diagnostic matches', async () => {
    const root = await sourceRepository('tests/validation.test.ts');
    const plan = await planZodIssuesRepair(root, finding, [failedTypecheck('tests/validation.test.ts')]);
    expect(plan.edits).toEqual([]);
    expect(plan.rejectedReason).toContain('test, fixture, or migration');
  });

  it('plans the documented TanStack Query v5 cacheTime option migration on the exact failing line', async () => {
    const root = await querySourceRepository('src/query.ts');
    const diagnostic = {
      ...failedTypecheck('src/query.ts'),
      output:
        "src/query.ts(4,71): error TS2769: Object literal may only specify known properties, and 'cacheTime' does not exist in type 'UseQueryOptions'.",
    };
    expect(extractCacheTimeDiagnostics([diagnostic])).toHaveLength(1);
    const plan = await planTanstackQueryGcTimeRepair(root, queryFinding, [diagnostic]);
    expect(plan.rejectedReason).toBeNull();
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].updated).toContain('gcTime: 60_000');
    expect(plan.edits[0].updated).not.toContain('cacheTime:');
  });
});

async function trackedRepository(
  files: Record<string, string>,
  typecheckScript = 'node -e "process.exit(0)"',
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'depsherpa-proposal-test-'));
  temporaryRoots.push(root);
  const allFiles = {
    'package.json': JSON.stringify(
      { name: 'proposal-fixture', private: true, scripts: { typecheck: typecheckScript } },
      null,
      2,
    ),
    ...files,
  };
  for (const [filePath, content] of Object.entries(allFiles)) {
    await mkdir(path.join(root, path.dirname(filePath)), { recursive: true });
    await writeFile(path.join(root, filePath), content);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

const genericFinding: DependencyFinding = {
  packageName: 'monaco-editor',
  section: 'dependencies',
  declaredRange: '0.50.0',
  currentVersion: '0.50.0',
  targetVersion: '0.51.0',
  releaseType: 'minor',
  risk: 'medium',
  reasons: ['The target changes the minor version.'],
};

function genericDiagnostic(filePath = 'src/editor.ts'): string {
  return `${filePath}(1,21): error TS2552: Cannot find name 'legacyMode'. Did you mean 'modernMode'?`;
}

function proposal(
  pathName = 'src/editor.ts',
  expectedText = 'export const mode = legacyMode();',
  replacement = 'export const mode = modernMode();',
): RepairProposal {
  return {
    kind: 'agent',
    id: 'generic-monaco-candidate',
    summary: 'Use the API name named by the compiler diagnostic.',
    evidence: [genericDiagnostic(pathName)],
    edits: [
      {
        path: pathName,
        expectedText,
        replacement,
        rationale: 'The compiler identifies modernMode as the replacement candidate.',
        diagnostic: genericDiagnostic(pathName),
      },
    ],
  };
}

function context(sources: RepairInvestigationContext['sources']): RepairInvestigationContext {
  return {
    finding: genericFinding,
    diagnostics: sources.map((source) => source.diagnostic),
    sources,
    manifest: { dependencies: { 'monaco-editor': '0.51.0' } },
    checks: [{ name: 'typecheck', command: 'npm run typecheck', available: true }],
    releaseEvidence: ['Installed package manifest: installed=monaco-editor@0.51.0.'],
    policy: getRepairCapabilities().policy,
  };
}

function sourceContext(pathName = 'src/editor.ts', content = 'export const mode = legacyMode();') {
  return { path: pathName, startLine: 1, endLine: 1, content, diagnostic: genericDiagnostic(pathName) };
}

describe('generic repair proposal policy', () => {
  it.each(['../outside.ts', '/tmp/outside.ts', 'src/../../outside.ts'])(
    'rejects path traversal or absolute paths: %s',
    async (unsafePath) => {
      const root = await trackedRepository({ 'src/editor.ts': 'export const mode = legacyMode();' });
      const result = await validateRepairProposal(root, proposal(unsafePath), context([sourceContext()]));
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.reason).toContain('repository-relative');
    },
  );

  it('rejects untracked files', async () => {
    const root = await trackedRepository({ 'src/editor.ts': 'export const mode = legacyMode();' });
    await writeFile(path.join(root, 'src/untracked.ts'), 'export const mode = legacyMode();');
    const result = await validateRepairProposal(
      root,
      proposal('src/untracked.ts'),
      context([sourceContext('src/untracked.ts')]),
    );
    expect(result).toEqual({ ok: false, reason: 'src/untracked.ts is not a tracked file.' });
  });

  it('rejects stale or ambiguous exact context', async () => {
    const root = await trackedRepository({
      'src/editor.ts': 'export const mode = legacyMode();\nexport const second = legacyMode();',
    });
    const stale = await validateRepairProposal(
      root,
      proposal(),
      context([sourceContext('src/editor.ts', 'export const mode = anotherMode();')]),
    );
    expect(stale).toMatchObject({ ok: false });

    const ambiguousProposal = proposal('src/editor.ts', 'legacyMode()', 'modernMode()');
    const ambiguous = await validateRepairProposal(
      root,
      ambiguousProposal,
      context([
        sourceContext('src/editor.ts', 'export const mode = legacyMode();\nexport const second = legacyMode();'),
      ]),
    );
    expect(ambiguous).toEqual({ ok: false, reason: 'src/editor.ts does not contain the expected text exactly once.' });
  });

  it('rejects more than three files and more than twelve changed lines', async () => {
    const files = Object.fromEntries(
      [1, 2, 3, 4].map((number) => [`src/file${number}.ts`, `export const value${number} = legacyMode();`]),
    );
    const root = await trackedRepository(files);
    const sources = Object.entries(files).map(([filePath, content]) => ({
      path: filePath,
      startLine: 1,
      endLine: 1,
      content,
      diagnostic: genericDiagnostic(filePath),
    }));
    const tooManyFiles: RepairProposal = {
      ...proposal(),
      edits: sources.map((source) => ({
        path: source.path,
        expectedText: source.content,
        replacement: source.content.replace('legacyMode', 'modernMode'),
        rationale: 'compiler evidence',
        diagnostic: source.diagnostic,
      })),
    };
    const fileResult = await validateRepairProposal(root, tooManyFiles, context(sources));
    expect(fileResult).toMatchObject({ ok: false });
    if (!fileResult.ok) expect(fileResult.reason).toContain('more than 3');

    const thirteenLines = Array.from({ length: 13 }, (_, index) => `const value${index} = legacyMode();`).join('\n');
    const lineRoot = await trackedRepository({ 'src/editor.ts': thirteenLines });
    const lineResult = await validateRepairProposal(
      lineRoot,
      proposal('src/editor.ts', thirteenLines, thirteenLines.replaceAll('legacyMode', 'modernMode')),
      context([sourceContext('src/editor.ts', thirteenLines)]),
    );
    expect(lineResult).toMatchObject({ ok: false });
    if (!lineResult.ok) expect(lineResult.reason).toContain('more than 12');
  });

  it.each([
    'tests/editor.ts',
    'src/fixtures/editor.ts',
    'migrations/editor.ts',
    'src/config/editor.ts',
    'vite.config.ts',
  ])('rejects tests, fixtures, migrations, and configuration: %s', async (blockedPath) => {
    const root = await trackedRepository({ [blockedPath]: 'export const mode = legacyMode();' });
    const result = await validateRepairProposal(root, proposal(blockedPath), context([sourceContext(blockedPath)]));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('test, fixture, or migration path, or is configuration');
  });

  it('rejects a tracked but unrelated file that was not in the diagnostic context', async () => {
    const root = await trackedRepository({
      'src/editor.ts': 'export const mode = legacyMode();',
      'src/unrelated.ts': 'export const mode = legacyMode();',
    });
    const result = await validateRepairProposal(
      root,
      proposal('src/unrelated.ts'),
      context([sourceContext('src/editor.ts')]),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('was not proposed from an exact diagnostic context');
  });

  it('rejects binary content even when the extension is allowed', async () => {
    const root = await trackedRepository({ 'src/editor.ts': 'placeholder' });
    await writeFile(path.join(root, 'src/editor.ts'), Buffer.from([108, 101, 103, 97, 99, 121, 0, 1]));
    const binaryProposal = proposal('src/editor.ts', 'legacy', 'modern');
    const result = await validateRepairProposal(
      root,
      binaryProposal,
      context([sourceContext('src/editor.ts', 'legacy')]),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('binary');
  });

  it('rejects type-check suppression and process execution in replacements', async () => {
    const root = await trackedRepository({ 'src/editor.ts': 'export const mode = legacyMode();' });
    const repairContext = context([sourceContext()]);
    for (const replacement of ['// @ts-ignore\nexport const mode = legacyMode();', 'process.exit(0);']) {
      const result = await validateRepairProposal(
        root,
        proposal('src/editor.ts', 'export const mode = legacyMode();', replacement),
        repairContext,
      );
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.reason).toContain('blocked suppression, process, network, or filesystem');
    }
  });
});

describe('generic proposal verification loop', () => {
  function failedGenericTypecheck(): CommandResult {
    return {
      name: 'typecheck',
      command: 'npm run typecheck',
      status: 'failed',
      exitCode: 2,
      durationMs: 1,
      output: genericDiagnostic(),
    };
  }

  it('validates, applies, and verifies a non-recipe Agent proposal', async () => {
    const verifier = `node -e "const fs=require('fs');process.exit(fs.readFileSync('src/editor.ts','utf8').includes('modernMode')?0:1)"`;
    const root = await trackedRepository({ 'src/editor.ts': 'export const mode = legacyMode();' }, verifier);
    const result = await attemptBoundedRepair({
      requested: true,
      workspacePath: root,
      finding: genericFinding,
      manifest: { dependencies: { 'monaco-editor': '0.51.0' } },
      checks: [{ name: 'typecheck', command: 'npm run typecheck', available: true }],
      candidateResults: [failedGenericTypecheck()],
      releaseEvidence: ['Installed package manifest: installed=monaco-editor@0.51.0.'],
      proposalGenerator: async (repairContext) => ({
        status: 'generated',
        proposal: proposal(repairContext.sources[0].path, repairContext.sources[0].content),
      }),
    });
    expect(result.status).toBe('verified');
    expect(result.proposalSource).toBe('agent');
    expect(result.recipeId).toBeNull();
    expect(result.patch).toContain('modernMode');
    expect(await readFile(path.join(root, 'src/editor.ts'), 'utf8')).toContain('modernMode');
  });

  it('reports failed verification without claiming success', async () => {
    const root = await trackedRepository(
      { 'src/editor.ts': 'export const mode = legacyMode();' },
      'node -e "process.exit(1)"',
    );
    const result = await attemptBoundedRepair({
      requested: true,
      workspacePath: root,
      finding: genericFinding,
      checks: [{ name: 'typecheck', command: 'npm run typecheck', available: true }],
      candidateResults: [failedGenericTypecheck()],
      proposalGenerator: async () => ({ status: 'generated', proposal: proposal() }),
    });
    expect(result.status).toBe('failed_verification');
    expect(result.verificationResults[0].status).toBe('failed');
    expect(result.rationale).toContain('did not pass');
  });

  it('degrades clearly when the model provider is unavailable', async () => {
    const root = await trackedRepository({ 'src/editor.ts': 'export const mode = legacyMode();' });
    const result = await attemptBoundedRepair({
      requested: true,
      workspacePath: root,
      finding: genericFinding,
      checks: [{ name: 'typecheck', command: 'npm run typecheck', available: true }],
      candidateResults: [failedGenericTypecheck()],
      proposalGenerator: async () => ({
        status: 'unavailable',
        reason: 'AWS credentials or model access are unavailable.',
      }),
    });
    expect(result.status).toBe('agent_unavailable');
    expect(result.patch).toBe('');
    expect(result.rationale).toContain('No source edit was applied');
  });
});
