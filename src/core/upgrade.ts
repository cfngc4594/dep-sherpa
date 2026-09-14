import { access, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { generateRepairProposal } from '../agent/openai.js';
import { analyzeUpgrade, inferPackageManager, listChecks } from './analysis.js';
import { readManifest } from './manifest.js';
import { attemptBoundedRepair, emptyRepairAttempt } from './repair.js';
import { runChecks, runCommand } from './runner.js';
import type {
  CheckComparison,
  CheckComparisonState,
  CommandResult,
  DependencySection,
  IsolatedUpgradeReport,
  RepairProposalGenerator,
  RepairSuggestion,
} from './types.js';

export interface IsolatedUpgradeOptions {
  repoPath: string;
  packageName: string;
  targetVersion: string;
  timeoutMs?: number;
  keepWorkspace?: boolean;
  attemptRepair?: boolean;
  proposalGenerator?: RepairProposalGenerator;
}

async function commandOutput(executable: string, args: string[], cwd: string): Promise<string> {
  const result = await runCommand({ name: executable, executable, args, cwd, timeoutMs: 30_000 });
  if (result.status !== 'passed') throw new Error(result.output || `${result.command} failed.`);
  return result.output.trim();
}

export function buildNpmUpgradeArgs(packageName: string, targetVersion: string, section: DependencySection): string[] {
  const sectionFlag: Partial<Record<DependencySection, string>> = {
    devDependencies: '--save-dev',
    peerDependencies: '--save-peer',
    optionalDependencies: '--save-optional',
  };
  return [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    ...(sectionFlag[section] ? [sectionFlag[section]!] : []),
    `${packageName}@${targetVersion}`,
  ];
}

function comparisonState(baseline: CommandResult['status'], candidate: CommandResult['status']): CheckComparisonState {
  if (baseline === 'skipped' || candidate === 'skipped') return 'not_run';
  const baselineFailed = baseline === 'failed' || baseline === 'timed_out';
  const candidateFailed = candidate === 'failed' || candidate === 'timed_out';
  if (!baselineFailed && !candidateFailed) return 'passed';
  if (!baselineFailed && candidateFailed) return 'introduced_failure';
  if (baselineFailed && !candidateFailed) return 'resolved';
  return 'pre_existing_failure';
}

export function compareCheckResults(
  baselineResults: CommandResult[],
  candidateResults: CommandResult[],
): CheckComparison[] {
  return candidateResults.map((candidate) => {
    const baseline = baselineResults.find((result) => result.name === candidate.name);
    const baselineStatus = baseline?.status ?? 'skipped';
    return {
      name: candidate.name,
      baseline: baselineStatus,
      candidate: candidate.status,
      state: comparisonState(baselineStatus, candidate.status),
    };
  });
}

export function diagnosticExcerpt(output: string): string {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return 'The command failed without emitting diagnostic output.';
  const diagnosticIndex = lines.findIndex((line) => /(?:error|failed|failure|exception|TS\d{3,5}|ERR!)/i.test(line));
  const start = diagnosticIndex >= 0 ? diagnosticIndex : 0;
  const excerpt = lines.slice(start, start + 3).join(' · ');
  return excerpt.length > 480 ? `${excerpt.slice(0, 477).trimEnd()}…` : excerpt;
}

function suggestionFor(comparison: CheckComparison, candidate?: CommandResult): RepairSuggestion | null {
  if (comparison.state !== 'introduced_failure' && comparison.state !== 'pre_existing_failure') return null;
  const introduced = comparison.state === 'introduced_failure';
  const prefix = introduced ? 'The upgrade introduced' : 'The baseline already contained';
  const actions: Record<string, string> = {
    typecheck:
      'Start with the first compiler diagnostic, then compare the affected API with the retained release notes.',
    test: 'Open the first failing assertion and determine whether the expected contract changed at the target version.',
    lint: 'Inspect the first lint diagnostic and keep any repair limited to files touched by the dependency API change.',
    build: 'Trace the earliest build error; later bundler messages are often secondary symptoms.',
  };
  return {
    check: comparison.name,
    classification: comparison.state,
    summary: `${prefix} a ${comparison.name} failure.`,
    nextAction: actions[comparison.name] ?? 'Inspect the earliest reported error before proposing a bounded repair.',
    evidence: diagnosticExcerpt(candidate?.output ?? ''),
  };
}

export function classifyVerdict(
  preparation: CommandResult,
  upgrade: CommandResult,
  comparisons: CheckComparison[],
  unexpectedChanges: string[] = [],
): IsolatedUpgradeReport['verdict'] {
  if (preparation.status !== 'passed' || upgrade.status !== 'passed') return 'blocked';
  if (comparisons.some((comparison) => comparison.state === 'introduced_failure')) return 'needs_repair';
  if (unexpectedChanges.length || comparisons.some((comparison) => comparison.state === 'pre_existing_failure'))
    return 'inconclusive';
  return 'ready_for_review';
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitPatch(workspacePath: string): Promise<{ changedFiles: string[]; patch: string }> {
  const files = await commandOutput(
    'git',
    ['diff', '--name-only', '--', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'],
    workspacePath,
  );
  const patchResult = await runCommand({
    name: 'capture_patch',
    executable: 'git',
    args: ['diff', '--no-ext-diff', '--', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'],
    cwd: workspacePath,
    timeoutMs: 30_000,
    maxOutputBytes: null,
  });
  if (patchResult.status !== 'passed') throw new Error(patchResult.output || 'Could not capture the upgrade patch.');
  return {
    changedFiles: files ? files.split('\n').filter(Boolean) : [],
    patch: patchResult.output,
  };
}

function packageDirectory(workspacePath: string, packageName: string): string | null {
  const parts = packageName.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (parts.length > 2 || (parts.length === 2 && !parts[0].startsWith('@'))) return null;
  const directory = path.resolve(workspacePath, 'node_modules', ...parts);
  const nodeModules = path.resolve(workspacePath, 'node_modules');
  return directory.startsWith(`${nodeModules}${path.sep}`) ? directory : null;
}

function repositoryLabel(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'url' in value && typeof value.url === 'string') return value.url;
  return null;
}

async function readBoundedPackageText(
  packageRoot: string,
  filename: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const filePath = path.resolve(packageRoot, filename);
  const relative = path.relative(packageRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Package evidence path escaped its root.');
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Package evidence is not a regular file.');
  const resolvedRoot = await realpath(packageRoot);
  const resolvedFile = await realpath(filePath);
  const resolvedRelative = path.relative(resolvedRoot, resolvedFile);
  if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative))
    throw new Error('Package evidence resolves outside its root.');
  const handle = await open(resolvedFile, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return {
      text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
      truncated: bytesRead > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

export async function collectInstalledPackageEvidence(
  workspacePath: string,
  packageName: string,
  targetVersion: string,
): Promise<string[]> {
  const directory = packageDirectory(workspacePath, packageName);
  if (!directory)
    return [`Requested exact target: ${packageName}@${targetVersion}. Package path was not safe to inspect.`];
  const evidence = [`Requested exact target: ${packageName}@${targetVersion}.`];
  try {
    const manifestSource = await readBoundedPackageText(directory, 'package.json', 128_000);
    if (manifestSource.truncated) throw new Error('Installed package manifest exceeds the evidence limit.');
    const manifest = JSON.parse(manifestSource.text) as {
      name?: unknown;
      version?: unknown;
      repository?: unknown;
      homepage?: unknown;
      engines?: unknown;
    };
    const fields = [
      typeof manifest.name === 'string' && typeof manifest.version === 'string'
        ? `installed=${manifest.name}@${manifest.version}`
        : null,
      repositoryLabel(manifest.repository) ? `repository=${repositoryLabel(manifest.repository)}` : null,
      typeof manifest.homepage === 'string' ? `homepage=${manifest.homepage}` : null,
      manifest.engines ? `engines=${JSON.stringify(manifest.engines)}` : null,
    ].filter((value): value is string => Boolean(value));
    evidence.push(`Installed package manifest: ${fields.join('; ') || 'no selected metadata fields were present'}.`);
  } catch {
    evidence.push(
      'The installed target package manifest could not be read; the exact npm request remains the available version evidence.',
    );
  }

  for (const filename of ['MIGRATION.md', 'UPGRADING.md', 'CHANGELOG.md', 'HISTORY.md']) {
    try {
      const source = await readBoundedPackageText(directory, filename, 64_000);
      const lines = source.text.split('\n');
      const targetMajor = targetVersion.split('.')[0];
      const index = lines.findIndex(
        (line) =>
          line.includes(targetVersion) ||
          new RegExp(`(?:^|\\D)v?${targetMajor}(?:\\.0)?(?:\\D|$)`, 'i').test(line) ||
          /migrat|breaking/i.test(line),
      );
      const start = Math.max(0, index >= 0 ? index - 2 : 0);
      const excerpt = lines
        .slice(start, start + 14)
        .join('\n')
        .trim()
        .slice(0, 3_500);
      if (excerpt)
        evidence.push(
          `${filename} excerpt from the installed ${packageName}@${targetVersion} package${source.truncated ? ' (source truncated to 64 KiB)' : ''} (untrusted release text):\n${excerpt}`,
        );
      break;
    } catch {
      // Published packages do not consistently include migration notes.
    }
  }
  return evidence;
}

async function workspaceStatus(workspacePath: string): Promise<string[]> {
  const status = await commandOutput('git', ['status', '--porcelain=v1', '--untracked-files=normal'], workspacePath);
  return status
    ? status
        .split('\n')
        .filter((entry) => entry && statusPath(entry) !== 'node_modules/')
        .slice(0, 200)
    : [];
}

export function statusPath(entry: string): string {
  const value = entry.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim();
  return value.includes(' -> ') ? value.split(' -> ').at(-1)! : value;
}

export async function upgradeInIsolation(options: IsolatedUpgradeOptions): Promise<IsolatedUpgradeReport> {
  const sourcePath = await realpath(path.resolve(options.repoPath));
  const gitRoot = await commandOutput('git', ['rev-parse', '--show-toplevel'], sourcePath);
  if ((await realpath(gitRoot)) !== sourcePath) {
    throw new Error('The repository path must be the Git root for this first isolated-runner release.');
  }

  const gitHead = await commandOutput('git', ['rev-parse', 'HEAD'], sourcePath);
  const dirtyOutput = await commandOutput('git', ['status', '--porcelain=v1'], sourcePath);
  const dirtyFilesIgnored = dirtyOutput
    ? dirtyOutput.split('\n').filter((entry) => entry && statusPath(entry) !== 'node_modules/')
    : [];
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'depsherpa-'));
  const workspacePath = path.join(temporaryRoot, 'workspace');

  try {
    const clone = await runCommand({
      name: 'clone',
      executable: 'git',
      args: ['clone', '--local', '--no-hardlinks', '--quiet', sourcePath, workspacePath],
      cwd: temporaryRoot,
      timeoutMs: 60_000,
    });
    if (clone.status !== 'passed') throw new Error(clone.output || 'Could not create the isolated Git clone.');
    const detachOrigin = await runCommand({
      name: 'detach_source_origin',
      executable: 'git',
      args: ['remote', 'remove', 'origin'],
      cwd: workspacePath,
      timeoutMs: 30_000,
    });
    if (detachOrigin.status !== 'passed')
      throw new Error(detachOrigin.output || 'Could not detach the disposable clone from the source repository.');

    const { manifest, manifestPath } = await readManifest(workspacePath);
    const finding = analyzeUpgrade(manifest, options.packageName, options.targetVersion);
    if (finding.currentVersion && !semver.gt(finding.targetVersion, finding.currentVersion)) {
      throw new Error(
        `The target ${finding.targetVersion} must be newer than the committed version ${finding.currentVersion}.`,
      );
    }
    const packageManager = inferPackageManager(manifest);
    if (packageManager !== 'npm') {
      throw new Error(
        `The isolated runner currently supports npm repositories; this project declares ${packageManager}.`,
      );
    }
    const checks = listChecks(manifest);
    const hasLockfile = await exists(path.join(workspacePath, 'package-lock.json'));
    if (!hasLockfile) {
      throw new Error('The isolated npm runner requires a committed package-lock.json.');
    }
    const preparationArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
    const preparation = await runCommand({
      name: 'prepare_dependencies',
      executable: 'npm',
      args: preparationArgs,
      cwd: workspacePath,
      timeoutMs: options.timeoutMs ?? 180_000,
    });

    const baselineResults =
      preparation.status === 'passed'
        ? await runChecks(checks, workspacePath, options.timeoutMs)
        : checks.map((check) => ({
            name: check.name,
            command: check.command,
            status: 'skipped' as const,
            exitCode: null,
            durationMs: 0,
            output: 'Dependency preparation failed, so the baseline check was not run.',
          }));
    const baselineSideEffects = preparation.status === 'passed' ? await workspaceStatus(workspacePath) : [];

    const upgrade =
      preparation.status === 'passed' && baselineSideEffects.length === 0
        ? await runCommand({
            name: 'apply_upgrade',
            executable: 'npm',
            args: buildNpmUpgradeArgs(options.packageName, finding.targetVersion, finding.section),
            cwd: workspacePath,
            timeoutMs: options.timeoutMs ?? 180_000,
          })
        : {
            name: 'apply_upgrade',
            command: `npm install ${options.packageName}@${finding.targetVersion}`,
            status: 'skipped' as const,
            exitCode: null,
            durationMs: 0,
            output:
              preparation.status !== 'passed'
                ? 'Dependency preparation failed, so the upgrade was not attempted.'
                : 'A baseline check changed the disposable checkout, so the upgrade was stopped before those side effects could be mistaken for upgrade work.',
          };

    const { changedFiles, patch } =
      upgrade.status === 'passed' ? await gitPatch(workspacePath) : { changedFiles: [], patch: '' };
    const candidateResults =
      upgrade.status === 'passed'
        ? await runChecks(checks, workspacePath, options.timeoutMs)
        : checks.map((check) => ({
            name: check.name,
            command: check.command,
            status: 'skipped' as const,
            exitCode: null,
            durationMs: 0,
            output: 'The upgrade was not applied, so the candidate check was not run.',
          }));
    const candidateManifest = upgrade.status === 'passed' ? (await readManifest(workspacePath)).manifest : manifest;
    const workspaceChangesAfterChecks =
      upgrade.status === 'passed' ? await workspaceStatus(workspacePath) : baselineSideEffects;
    const expectedChangePaths = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);
    const unexpectedCandidateChanges = workspaceChangesAfterChecks.filter(
      (entry) => !expectedChangePaths.has(statusPath(entry)),
    );
    const comparisons = compareCheckResults(baselineResults, candidateResults);
    const releaseEvidence =
      upgrade.status === 'passed'
        ? await collectInstalledPackageEvidence(workspacePath, options.packageName, finding.targetVersion)
        : [
            `Requested exact target: ${options.packageName}@${finding.targetVersion}; the upgrade did not complete, so installed-package evidence is unavailable.`,
          ];
    const repairSuggestions = comparisons
      .map((comparison) =>
        suggestionFor(
          comparison,
          candidateResults.find((result) => result.name === comparison.name),
        ),
      )
      .filter((suggestion): suggestion is RepairSuggestion => suggestion !== null);
    const baseVerdict = classifyVerdict(preparation, upgrade, comparisons, unexpectedCandidateChanges);
    const hasPreExistingFailure = comparisons.some((comparison) => comparison.state === 'pre_existing_failure');
    const repair = !options.attemptRepair
      ? emptyRepairAttempt(false, 'not_requested', 'Automatic repair was not requested.')
      : baseVerdict === 'ready_for_review'
        ? emptyRepairAttempt(true, 'not_needed', 'All candidate checks passed; no source repair was needed.')
        : baseVerdict === 'needs_repair' && !hasPreExistingFailure && unexpectedCandidateChanges.length === 0
          ? await attemptBoundedRepair({
              requested: true,
              workspacePath,
              finding,
              manifest: candidateManifest,
              checks,
              candidateResults,
              releaseEvidence,
              proposalGenerator: options.proposalGenerator ?? generateRepairProposal,
              timeoutMs: options.timeoutMs,
            })
          : emptyRepairAttempt(
              true,
              'policy_rejected',
              'Repair was not attempted because the candidate contained pre-existing failures, check side effects, or an incomplete setup.',
            );
    const finalResults = repair.verificationResults.length ? repair.verificationResults : candidateResults;
    const finalChangedFiles = repair.patch ? repair.changedFiles : changedFiles;
    const finalPatch = repair.patch || patch;
    const verdict = repair.status === 'verified' ? 'repaired_ready_for_review' : baseVerdict;

    const report: IsolatedUpgradeReport = {
      mode: 'isolated-local',
      generatedAt: new Date().toISOString(),
      repository: manifest.name ?? path.basename(sourcePath),
      manifestPath,
      packageManager,
      finding,
      checks,
      results: finalResults,
      externalWritesAllowed: false,
      source: { path: sourcePath, gitHead, dirtyFilesIgnored },
      workspace: {
        disposable: true,
        retained: Boolean(options.keepWorkspace),
        path: options.keepWorkspace ? workspacePath : null,
      },
      preparation,
      upgrade,
      baselineResults,
      baselineSideEffects,
      candidateResults,
      workspaceChangesAfterChecks,
      unexpectedCandidateChanges,
      comparisons,
      upgradeChangedFiles: changedFiles,
      upgradePatch: patch,
      changedFiles: finalChangedFiles,
      patch: finalPatch,
      verdict,
      repairSuggestions,
      repair,
      installScriptsAllowed: false,
    };
    return report;
  } finally {
    if (!options.keepWorkspace) await rm(temporaryRoot, { recursive: true, force: true });
  }
}
