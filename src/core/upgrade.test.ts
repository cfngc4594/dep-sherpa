import { describe, expect, it } from 'vitest';
import { buildNpmUpgradeArgs, classifyVerdict, compareCheckResults, diagnosticExcerpt, statusPath } from './upgrade';
import type { CommandResult } from './types';

function result(name: string, status: CommandResult['status']): CommandResult {
  return { name, command: `npm run ${name}`, status, exitCode: status === 'passed' ? 0 : 1, durationMs: 1, output: '' };
}

describe('isolated upgrade planning', () => {
  it('builds a shell-free exact npm upgrade for the existing dependency section', () => {
    expect(buildNpmUpgradeArgs('typescript', '5.9.3', 'devDependencies')).toEqual([
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--save-dev', 'typescript@5.9.3',
    ]);
    expect(buildNpmUpgradeArgs('@types/node', '24.0.0', 'dependencies').at(-1)).toBe('@types/node@24.0.0');
  });

  it('distinguishes upgrade regressions from pre-existing failures', () => {
    const comparisons = compareCheckResults(
      [result('typecheck', 'passed'), result('test', 'failed'), result('build', 'failed')],
      [result('typecheck', 'failed'), result('test', 'failed'), result('build', 'passed')],
    );
    expect(comparisons.map(({ name, state }) => ({ name, state }))).toEqual([
      { name: 'typecheck', state: 'introduced_failure' },
      { name: 'test', state: 'pre_existing_failure' },
      { name: 'build', state: 'resolved' },
    ]);
  });

  it('blocks on setup failures and otherwise prioritizes introduced regressions', () => {
    const passed = result('prepare_dependencies', 'passed');
    expect(classifyVerdict(result('prepare_dependencies', 'failed'), passed, [])).toBe('blocked');
    expect(classifyVerdict(passed, passed, [{ name: 'test', baseline: 'passed', candidate: 'failed', state: 'introduced_failure' }])).toBe('needs_repair');
    expect(classifyVerdict(passed, passed, [{ name: 'test', baseline: 'failed', candidate: 'failed', state: 'pre_existing_failure' }])).toBe('inconclusive');
    expect(classifyVerdict(passed, passed, [{ name: 'test', baseline: 'passed', candidate: 'passed', state: 'passed' }])).toBe('ready_for_review');
  });

  it('parses porcelain paths even when output trimming removes the first status column', () => {
    expect(statusPath(' M package-lock.json')).toBe('package-lock.json');
    expect(statusPath('M package-lock.json')).toBe('package-lock.json');
    expect(statusPath('?? generated.txt')).toBe('generated.txt');
    expect(statusPath('R  old.ts -> new.ts')).toBe('new.ts');
  });

  it('retains the first actionable diagnostic and bounds noisy output', () => {
    const output = `starting\n\u001b[31msrc/index.ts(8,3): error TS2339: Property issues does not exist\u001b[0m\ncontext line\nmore context\n${'x'.repeat(600)}`;
    expect(diagnosticExcerpt(output)).toBe('src/index.ts(8,3): error TS2339: Property issues does not exist · context line · more context');
    expect(diagnosticExcerpt('')).toContain('without emitting');
  });
});
