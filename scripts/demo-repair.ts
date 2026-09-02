#!/usr/bin/env node
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIsolatedUpgradeReport } from '../src/core/report';
import { runCommand } from '../src/core/runner';
import { upgradeInIsolation } from '../src/core/upgrade';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(projectRoot, 'fixtures', 'zod-repair-npm');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'depsherpa-demo-'));
const repositoryPath = path.join(temporaryRoot, 'repository');

async function requireCommand(executable: string, args: string[]): Promise<void> {
  const result = await runCommand({ name: executable, executable, args, cwd: repositoryPath, timeoutMs: 30_000 });
  if (result.status !== 'passed') throw new Error(result.output || `${result.command} failed.`);
}

try {
  await cp(fixturePath, repositoryPath, { recursive: true });
  await requireCommand('git', ['init', '--quiet']);
  await requireCommand('git', ['add', '.']);
  await requireCommand('git', ['-c', 'user.name=DepSherpa', '-c', 'user.email=local@depsherpa.invalid', 'commit', '--quiet', '-m', 'demo: zod 3 baseline']);

  const report = await upgradeInIsolation({
    repoPath: repositoryPath,
    packageName: 'zod',
    targetVersion: '4.1.5',
    attemptRepair: true,
  });
  console.log(renderIsolatedUpgradeReport(report));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
