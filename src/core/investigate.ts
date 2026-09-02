import path from 'node:path';
import { analyzeUpgrade, inferPackageManager, listChecks, readManifest } from './manifest';
import { runChecks } from './runner';
import type { InvestigationReport } from './types';

export interface InvestigationOptions {
  repoPath: string;
  packageName: string;
  targetVersion: string;
  runProjectChecks?: boolean;
  timeoutMs?: number;
}

export async function investigate(options: InvestigationOptions): Promise<InvestigationReport> {
  const repoPath = path.resolve(options.repoPath);
  const { manifest, manifestPath } = await readManifest(repoPath);
  const finding = analyzeUpgrade(manifest, options.packageName, options.targetVersion);
  const checks = listChecks(manifest);
  const results = options.runProjectChecks
    ? await runChecks(checks, repoPath, options.timeoutMs)
    : checks.map((check) => ({
        name: check.name,
        command: check.command,
        status: 'skipped' as const,
        exitCode: null,
        durationMs: 0,
        output: 'Dry run: pass --run-checks to execute this project script.',
      }));

  return {
    generatedAt: new Date().toISOString(),
    repository: manifest.name ?? path.basename(repoPath),
    manifestPath,
    packageManager: inferPackageManager(manifest),
    finding,
    checks,
    results,
    externalWritesAllowed: false,
  };
}
