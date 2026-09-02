import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { runChecks, runCommand } from './runner';
import type {
  CommandResult,
  DependencyFinding,
  ProjectCheck,
  RepairAttempt,
  RepairPolicyLimits,
} from './types';

const policy: RepairPolicyLimits = {
  maxFiles: 3,
  maxChangedLines: 12,
  allowedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  forbiddenPathPatterns: ['tests/', '__tests__/', 'fixtures/', 'migrations/', '.test.', '.spec.'],
};

export function getRepairCapabilities() {
  return {
    policy,
    recipes: [{
      id: 'zod-v4-errors-to-issues',
      packageName: 'zod',
      requirement: 'A TypeScript diagnostic must identify an exact tracked source line using ZodError.errors during a v3-to-v4 upgrade.',
    }],
    externalWritesAllowed: false as const,
  };
}

interface LineDiagnostic {
  path: string;
  line: number;
  evidence: string;
}

interface PlannedEdit {
  path: string;
  source: string;
  updated: string;
  changedLines: number;
  evidence: string[];
}

export function emptyRepairAttempt(
  requested: boolean,
  status: RepairAttempt['status'],
  rationale: string,
): RepairAttempt {
  return {
    requested,
    status,
    recipeId: null,
    rationale,
    evidence: [],
    changedFiles: [],
    changedLines: 0,
    patch: '',
    verificationResults: [],
    unexpectedChanges: [],
    policy,
  };
}

function normalizeDiagnosticPath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) return null;
  return path.posix.normalize(normalized);
}

export function extractZodErrorsDiagnostics(results: CommandResult[]): LineDiagnostic[] {
  const typecheck = results.find((result) => result.name === 'typecheck' && result.status === 'failed');
  if (!typecheck || !/(?:Property ['"]errors['"] does not exist|\.errors\b)/i.test(typecheck.output)) return [];

  const diagnostics: LineDiagnostic[] = [];
  const pattern = /(?:^|\n)([^\n()]+\.(?:tsx?|jsx?))\((\d+),(\d+)\):[^\n]*(?:Property ['"]errors['"] does not exist|\.errors\b)[^\n]*/gi;
  for (const match of typecheck.output.matchAll(pattern)) {
    const diagnosticPath = normalizeDiagnosticPath(match[1].trim());
    if (!diagnosticPath) continue;
    diagnostics.push({ path: diagnosticPath, line: Number(match[2]), evidence: match[0].trim() });
  }
  return diagnostics;
}

function forbidden(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return policy.forbiddenPathPatterns.some((pattern) => lower.includes(pattern));
}

async function trackedFiles(workspacePath: string): Promise<Set<string>> {
  const result = await runCommand({
    name: 'list_tracked_sources',
    executable: 'git',
    args: ['ls-files', '-z'],
    cwd: workspacePath,
    timeoutMs: 30_000,
  });
  if (result.status !== 'passed') throw new Error(result.output || 'Could not list tracked source files.');
  return new Set(result.output.split('\0').map((file) => file.trim()).filter(Boolean));
}

export async function planZodIssuesRepair(
  workspacePath: string,
  finding: DependencyFinding,
  candidateResults: CommandResult[],
): Promise<{ edits: PlannedEdit[]; rejectedReason: string | null }> {
  if (
    finding.packageName !== 'zod'
    || !finding.currentVersion
    || !semver.lt(finding.currentVersion, '4.0.0')
    || !semver.gte(finding.targetVersion, '4.0.0')
  ) {
    return { edits: [], rejectedReason: null };
  }

  const diagnostics = extractZodErrorsDiagnostics(candidateResults);
  if (!diagnostics.length) return { edits: [], rejectedReason: null };
  const tracked = await trackedFiles(workspacePath);
  const grouped = new Map<string, LineDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const extension = path.posix.extname(diagnostic.path);
    if (!tracked.has(diagnostic.path)) return { edits: [], rejectedReason: `The diagnostic path ${diagnostic.path} is not a tracked file.` };
    if (!policy.allowedExtensions.includes(extension)) return { edits: [], rejectedReason: `${diagnostic.path} is not an allowed source-file type.` };
    if (forbidden(diagnostic.path)) return { edits: [], rejectedReason: `${diagnostic.path} is inside a test, fixture, or migration path.` };
    grouped.set(diagnostic.path, [...(grouped.get(diagnostic.path) ?? []), diagnostic]);
  }
  if (grouped.size > policy.maxFiles) return { edits: [], rejectedReason: `The repair would touch more than ${policy.maxFiles} files.` };

  const edits: PlannedEdit[] = [];
  for (const [filePath, fileDiagnostics] of grouped) {
    const absolutePath = path.join(workspacePath, filePath);
    const source = await readFile(absolutePath, 'utf8');
    if (!/(?:from\s+['"]zod['"]|require\(['"]zod['"]\))/.test(source)) {
      return { edits: [], rejectedReason: `${filePath} does not import zod, so the diagnostic is not sufficiently attributable.` };
    }
    const lines = source.split('\n');
    let changedLines = 0;
    for (const diagnostic of fileDiagnostics) {
      const index = diagnostic.line - 1;
      if (!lines[index]?.includes('.errors')) {
        return { edits: [], rejectedReason: `${filePath}:${diagnostic.line} no longer contains the documented .errors access.` };
      }
      const updatedLine = lines[index].replace(/\.errors\b/g, '.issues');
      if (updatedLine !== lines[index]) {
        lines[index] = updatedLine;
        changedLines += 1;
      }
    }
    edits.push({
      path: filePath,
      source,
      updated: lines.join('\n'),
      changedLines,
      evidence: [...new Set(fileDiagnostics.map((diagnostic) => diagnostic.evidence))],
    });
  }

  const changedLines = edits.reduce((total, edit) => total + edit.changedLines, 0);
  if (!changedLines) return { edits: [], rejectedReason: 'No exact .errors access was available to repair.' };
  if (changedLines > policy.maxChangedLines) {
    return { edits: [], rejectedReason: `The repair would change more than ${policy.maxChangedLines} source lines.` };
  }
  return { edits, rejectedReason: null };
}

async function captureDiff(workspacePath: string): Promise<{ files: string[]; patch: string }> {
  const files = await runCommand({
    name: 'repair_changed_files',
    executable: 'git',
    args: ['diff', '--name-only'],
    cwd: workspacePath,
    timeoutMs: 30_000,
  });
  const patch = await runCommand({
    name: 'repair_patch',
    executable: 'git',
    args: ['diff', '--no-ext-diff'],
    cwd: workspacePath,
    timeoutMs: 30_000,
  });
  if (files.status !== 'passed' || patch.status !== 'passed') throw new Error(files.output || patch.output || 'Could not capture the repaired patch.');
  return { files: files.output.split('\n').filter(Boolean), patch: patch.output };
}

async function statusPaths(workspacePath: string): Promise<string[]> {
  const result = await runCommand({
    name: 'repair_status',
    executable: 'git',
    args: ['status', '--porcelain=v1', '--untracked-files=normal'],
    cwd: workspacePath,
    timeoutMs: 30_000,
  });
  if (result.status !== 'passed') throw new Error(result.output || 'Could not inspect repaired workspace status.');
  return result.output
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim())
    .filter((file) => file !== 'node_modules/');
}

export async function attemptBoundedRepair(input: {
  requested: boolean;
  workspacePath: string;
  finding: DependencyFinding;
  checks: ProjectCheck[];
  candidateResults: CommandResult[];
  timeoutMs?: number;
}): Promise<RepairAttempt> {
  if (!input.requested) return emptyRepairAttempt(false, 'not_requested', 'Automatic repair was not requested.');
  const introducedFailures = input.candidateResults.filter((result) => result.status === 'failed' || result.status === 'timed_out');
  if (!introducedFailures.length) return emptyRepairAttempt(true, 'not_needed', 'All candidate checks passed; no source repair was needed.');

  const { edits, rejectedReason } = await planZodIssuesRepair(input.workspacePath, input.finding, input.candidateResults);
  if (rejectedReason) return emptyRepairAttempt(true, 'policy_rejected', rejectedReason);
  if (!edits.length) return emptyRepairAttempt(true, 'unsupported', 'No evidence-backed bounded repair recipe matched these diagnostics.');

  for (const edit of edits) await writeFile(path.join(input.workspacePath, edit.path), edit.updated, 'utf8');
  const diff = await captureDiff(input.workspacePath);
  const allowedChanges = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', ...edits.map((edit) => edit.path)]);
  const statusBeforeVerification = await statusPaths(input.workspacePath);
  const policyViolations = statusBeforeVerification.filter((file) => !allowedChanges.has(file));
  if (policyViolations.length) {
    return {
      ...emptyRepairAttempt(true, 'policy_rejected', 'The proposed repair produced files outside the allowed patch.'),
      recipeId: 'zod-v4-errors-to-issues',
      evidence: edits.flatMap((edit) => edit.evidence),
      changedFiles: diff.files,
      changedLines: edits.reduce((total, edit) => total + edit.changedLines, 0),
      patch: diff.patch,
      unexpectedChanges: policyViolations,
    };
  }

  const verificationResults = await runChecks(input.checks, input.workspacePath, input.timeoutMs);
  const statusAfterVerification = await statusPaths(input.workspacePath);
  const diffAfterVerification = await captureDiff(input.workspacePath);
  const verificationChangedPatch = diffAfterVerification.patch !== diff.patch;
  const unexpectedChanges = [
    ...statusAfterVerification.filter((file) => !allowedChanges.has(file)),
    ...(verificationChangedPatch ? ['verification scripts altered the proposed patch'] : []),
  ];
  const allAvailableChecksPassed = verificationResults
    .filter((result) => input.checks.find((check) => check.name === result.name)?.available)
    .every((result) => result.status === 'passed');
  const verified = allAvailableChecksPassed && unexpectedChanges.length === 0;

  return {
    requested: true,
    status: verified ? 'verified' : 'failed_verification',
    recipeId: 'zod-v4-errors-to-issues',
    rationale: verified
      ? 'The compiler-attributed Zod v4 property migration passed every declared repository check.'
      : 'The bounded edit was applied, but the repaired candidate did not pass every safety condition.',
    evidence: edits.flatMap((edit) => edit.evidence),
    changedFiles: diff.files,
    changedLines: edits.reduce((total, edit) => total + edit.changedLines, 0),
    patch: diff.patch,
    verificationResults,
    unexpectedChanges,
    policy,
  };
}
