import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractZodErrorsDiagnostics, planZodIssuesRepair } from './repair';
import type { CommandResult, DependencyFinding } from './types';

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

async function sourceRepository(filePath: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'depsherpa-repair-test-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, path.dirname(filePath)), { recursive: true });
  await writeFile(path.join(root, filePath), [
    "import { ZodError } from 'zod';",
    '',
    'export function format(error: ZodError) {',
    '  return error.errors.map(String);',
    '}',
  ].join('\n'));
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
        evidence: "src/validation.ts(4,16): error TS2339: Property 'errors' does not exist on type 'ZodError<unknown>'.",
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
});
