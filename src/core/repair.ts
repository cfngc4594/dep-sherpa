import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import semver from 'semver';
import { runChecks, runCommand } from './runner.js';
import type {
  CommandResult,
  DependencyFinding,
  PackageManifest,
  ProjectCheck,
  RepairAttempt,
  RepairContextExcerpt,
  RepairEdit,
  RepairInvestigationContext,
  RepairPolicyLimits,
  RepairProposal,
  RepairProposalGenerator,
} from './types.js';

const policy: RepairPolicyLimits = {
  maxFiles: 3,
  maxChangedLines: 12,
  allowedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  forbiddenPathPatterns: [
    'test/',
    'tests/',
    '__tests__/',
    'fixture/',
    'fixtures/',
    '__fixtures__/',
    'migration/',
    'migrations/',
    'config/',
    '.test.',
    '.spec.',
    '.config.',
  ],
};

const MAX_DIAGNOSTICS = 12;
const MAX_DIAGNOSTIC_LENGTH = 800;
const MAX_CONTEXT_EXCERPTS = 6;
const CONTEXT_RADIUS = 4;
const MAX_CONTEXT_LENGTH = 12_000;
const MAX_EDIT_TEXT_LENGTH = 8_000;

export function getRepairCapabilities() {
  return {
    policy,
    proposalContract: {
      exactReplacementOnly: true,
      contextMustHaveBeenRead: true,
      verificationRequired: true,
      sourceRepositoryWritesAllowed: false,
      agentTools: 'none',
    },
    recipes: [
      {
        id: 'zod-v4-errors-to-issues',
        packageName: 'zod',
        requirement:
          'A TypeScript diagnostic must identify an exact tracked source line using ZodError.errors during a v3-to-v4 upgrade.',
        referenceUrl: 'https://zod.dev/v4/changelog',
      },
      {
        id: 'tanstack-query-v5-cachetime-to-gctime',
        packageName: '@tanstack/react-query',
        requirement:
          'A TypeScript diagnostic must identify an exact tracked source line using the removed cacheTime option during a v4-to-v5 upgrade.',
        referenceUrl:
          'https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5#rename-cachetime-to-gctime',
      },
    ],
    genericProposal:
      'When no recipe matches, a configured OpenAI-compatible model may return a structured proposal. The deterministic policy, not the model, decides whether it can be applied.',
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
  proposalEdits: RepairEdit[];
}
interface RecipePlan {
  recipeId: string | null;
  proposal: RepairProposal | null;
  rejectedReason: string | null;
  successRationale: string | null;
}
interface ValidatedFileEdit {
  path: string;
  source: string;
  updated: string;
}
export type ProposalValidationResult =
  { ok: true; files: ValidatedFileEdit[]; changedLines: number } | { ok: false; reason: string };

export function emptyRepairAttempt(
  requested: boolean,
  status: RepairAttempt['status'],
  rationale: string,
): RepairAttempt {
  return {
    requested,
    status,
    recipeId: null,
    proposal: null,
    proposalSource: null,
    contextRead: [],
    releaseEvidence: [],
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

function normalizeDiagnosticPath(value: string, workspacePath?: string): string | null {
  let normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (workspacePath && path.isAbsolute(value)) {
    const relative = path.relative(workspacePath, value).replace(/\\/g, '/');
    if (!relative.startsWith('../') && relative !== '..') normalized = relative;
  }
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;
  const result = path.posix.normalize(normalized);
  return result === '.' || result.startsWith('../') ? null : result;
}

function normalizeProposalPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) return null;
  if (path.posix.isAbsolute(value) || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return null;
  if (value.split('/').includes('..') || value.startsWith('./')) return null;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' ? normalized : null;
}

function forbidden(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const basename = path.posix.basename(lower);
  const segments = lower.split('/');
  return (
    segments.some((segment) =>
      [
        'test',
        'tests',
        '__tests__',
        'fixture',
        'fixtures',
        '__fixtures__',
        'migration',
        'migrations',
        'config',
      ].includes(segment),
    ) ||
    ['.test.', '.spec.', '.config.'].some((pattern) => basename.includes(pattern)) ||
    ['config.ts', 'config.tsx', 'config.js', 'config.jsx'].includes(basename) ||
    basename.startsWith('.eslintrc.') ||
    basename.startsWith('eslint.config.')
  );
}

async function isTracked(workspacePath: string, filePath: string): Promise<boolean> {
  const result = await runCommand({
    name: 'check_tracked_source',
    executable: 'git',
    args: ['ls-files', '--error-unmatch', '--', filePath],
    cwd: workspacePath,
    timeoutMs: 30_000,
  });
  return result.status === 'passed';
}

async function readAllowedSource(workspacePath: string, filePath: string): Promise<string> {
  const absolutePath = path.resolve(workspacePath, filePath);
  const relative = path.relative(workspacePath, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`${filePath} escapes the disposable workspace.`);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${filePath} is not a regular source file.`);
  const resolvedWorkspace = await realpath(workspacePath);
  const resolvedFile = await realpath(absolutePath);
  const resolvedRelative = path.relative(resolvedWorkspace, resolvedFile);
  if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative))
    throw new Error(`${filePath} resolves outside the disposable workspace.`);
  const buffer = await readFile(resolvedFile);
  if (buffer.includes(0)) throw new Error(`${filePath} appears to be binary.`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${filePath} is not valid UTF-8 text.`);
  }
}

export function extractZodErrorsDiagnostics(results: CommandResult[]): LineDiagnostic[] {
  return extractPropertyDiagnostics(results, 'errors');
}
export function extractCacheTimeDiagnostics(results: CommandResult[]): LineDiagnostic[] {
  return extractPropertyDiagnostics(results, 'cacheTime');
}
function extractPropertyDiagnostics(results: CommandResult[], property: string): LineDiagnostic[] {
  const typecheck = results.find((result) => result.name === 'typecheck' && result.status === 'failed');
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const diagnosticPattern = new RegExp(
    `(?:Property )?['"]${escapedProperty}['"] does not exist|${escapedProperty} is not expected|\\.${escapedProperty}\\b`,
    'i',
  );
  if (!typecheck || !diagnosticPattern.test(typecheck.output)) return [];
  const diagnostics: LineDiagnostic[] = [];
  const pattern = new RegExp(
    `(?:^|\\n)([^\\n()]+\\.(?:tsx?|jsx?))\\((\\d+),(\\d+)\\):[^\\n]*(?:(?:Property )?['"]${escapedProperty}['"] does not exist|${escapedProperty} is not expected|\\.${escapedProperty}\\b)[^\\n]*`,
    'gi',
  );
  for (const match of typecheck.output.matchAll(pattern)) {
    const diagnosticPath = normalizeDiagnosticPath(match[1].trim());
    if (diagnosticPath) diagnostics.push({ path: diagnosticPath, line: Number(match[2]), evidence: match[0].trim() });
  }
  return diagnostics;
}

function diagnosticLocation(line: string, workspacePath: string): { path: string; line: number } | null {
  const match =
    line.match(/(?:^|\s)(.+?\.(?:tsx?|jsx?))\((\d+),(\d+)\)/i) ??
    line.match(/(?:^|\s)(.+?\.(?:tsx?|jsx?)):(\d+):(\d+)/i);
  if (!match) return null;
  const filePath = normalizeDiagnosticPath(match[1].trim(), workspacePath);
  return filePath ? { path: filePath, line: Number(match[2]) } : null;
}

export function collectFailureDiagnostics(candidateResults: CommandResult[]): string[] {
  const diagnostics: string[] = [];
  for (const result of candidateResults) {
    if (result.status !== 'failed' && result.status !== 'timed_out') continue;
    const lines = result.output
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const actionable = lines.filter((line) => /(?:error|failed|failure|exception|TS\d{3,5}|ERR!)/i.test(line));
    for (const line of actionable.length ? actionable : lines.slice(0, 3)) {
      const bounded = line.slice(0, MAX_DIAGNOSTIC_LENGTH);
      if (!diagnostics.includes(bounded)) diagnostics.push(bounded);
      if (diagnostics.length >= MAX_DIAGNOSTICS) return diagnostics;
    }
  }
  return diagnostics;
}

export async function collectRepairContexts(
  workspacePath: string,
  candidateResults: CommandResult[],
): Promise<RepairContextExcerpt[]> {
  const contexts: RepairContextExcerpt[] = [];
  const seenFiles = new Set<string>();
  for (const diagnostic of collectFailureDiagnostics(candidateResults)) {
    if (contexts.length >= MAX_CONTEXT_EXCERPTS) break;
    const location = diagnosticLocation(diagnostic, workspacePath);
    if (!location || forbidden(location.path)) continue;
    if (!policy.allowedExtensions.includes(path.posix.extname(location.path))) continue;
    if (!seenFiles.has(location.path) && seenFiles.size >= policy.maxFiles) continue;
    if (!(await isTracked(workspacePath, location.path))) continue;
    let source: string;
    try {
      source = await readAllowedSource(workspacePath, location.path);
    } catch {
      continue;
    }
    const lines = source.split('\n');
    if (!Number.isInteger(location.line) || location.line < 1 || location.line > lines.length) continue;
    const startLine = Math.max(1, location.line - CONTEXT_RADIUS);
    const endLine = Math.min(lines.length, location.line + CONTEXT_RADIUS);
    const content = lines.slice(startLine - 1, endLine).join('\n');
    if (content.length > MAX_CONTEXT_LENGTH) continue;
    contexts.push({ path: location.path, startLine, endLine, content, diagnostic });
    seenFiles.add(location.path);
  }
  return contexts;
}

function toProposal(id: string, summary: string, edits: PlannedEdit[], referenceUrl: string): RepairProposal {
  return {
    kind: 'recipe',
    id,
    summary,
    evidence: [...new Set([referenceUrl, ...edits.flatMap((edit) => edit.evidence)])],
    edits: edits.flatMap((edit) => edit.proposalEdits),
  };
}

export async function planZodIssuesRepair(
  workspacePath: string,
  finding: DependencyFinding,
  candidateResults: CommandResult[],
) {
  if (
    finding.packageName !== 'zod' ||
    !finding.currentVersion ||
    !semver.lt(finding.currentVersion, '4.0.0') ||
    !semver.gte(finding.targetVersion, '4.0.0')
  )
    return { edits: [], rejectedReason: null };
  const diagnostics = extractZodErrorsDiagnostics(candidateResults);
  if (!diagnostics.length) return { edits: [], rejectedReason: null };
  return planPropertyRename(workspacePath, diagnostics, {
    dependency: 'zod',
    expectedPattern: /\.errors\b/g,
    expectedDescription: 'the documented .errors access',
    replacement: '.issues',
    rationale: 'Zod v4 exposes validation issues through ZodError.issues instead of ZodError.errors.',
  });
}

export async function planTanstackQueryGcTimeRepair(
  workspacePath: string,
  finding: DependencyFinding,
  candidateResults: CommandResult[],
) {
  if (
    finding.packageName !== '@tanstack/react-query' ||
    !finding.currentVersion ||
    !semver.lt(finding.currentVersion, '5.0.0') ||
    !semver.gte(finding.targetVersion, '5.0.0')
  )
    return { edits: [], rejectedReason: null };
  const diagnostics = extractCacheTimeDiagnostics(candidateResults);
  if (!diagnostics.length) return { edits: [], rejectedReason: null };
  return planPropertyRename(workspacePath, diagnostics, {
    dependency: '@tanstack/react-query',
    expectedPattern: /\bcacheTime\s*:/g,
    expectedDescription: 'the documented cacheTime option',
    replacement: 'gcTime:',
    rationale: 'TanStack Query v5 renamed the inactive-query cache option from cacheTime to gcTime.',
  });
}

async function planPropertyRename(
  workspacePath: string,
  diagnostics: LineDiagnostic[],
  change: {
    dependency: string;
    expectedPattern: RegExp;
    expectedDescription: string;
    replacement: string;
    rationale: string;
  },
): Promise<{ edits: PlannedEdit[]; rejectedReason: string | null }> {
  const grouped = new Map<string, LineDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!(await isTracked(workspacePath, diagnostic.path)))
      return { edits: [], rejectedReason: `The diagnostic path ${diagnostic.path} is not a tracked file.` };
    if (!policy.allowedExtensions.includes(path.posix.extname(diagnostic.path)))
      return { edits: [], rejectedReason: `${diagnostic.path} is not an allowed source-file type.` };
    if (forbidden(diagnostic.path))
      return {
        edits: [],
        rejectedReason: `${diagnostic.path} is inside a test, fixture, or migration path, or is configuration.`,
      };
    grouped.set(diagnostic.path, [...(grouped.get(diagnostic.path) ?? []), diagnostic]);
  }
  if (grouped.size > policy.maxFiles)
    return { edits: [], rejectedReason: `The repair would touch more than ${policy.maxFiles} files.` };
  const edits: PlannedEdit[] = [];
  for (const [filePath, fileDiagnostics] of grouped) {
    const source = await readAllowedSource(workspacePath, filePath);
    const escapedDependency = change.dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      !new RegExp(`(?:from\\s+['"]${escapedDependency}['"]|require\\(['"]${escapedDependency}['"]\\))`).test(source)
    ) {
      return {
        edits: [],
        rejectedReason: `${filePath} does not import ${change.dependency}, so the diagnostic is not sufficiently attributable.`,
      };
    }
    const lines = source.split('\n');
    const proposalEdits: RepairEdit[] = [];
    for (const diagnostic of fileDiagnostics) {
      const index = diagnostic.line - 1;
      const originalLine = lines[index] ?? '';
      change.expectedPattern.lastIndex = 0;
      if (!change.expectedPattern.test(originalLine))
        return {
          edits: [],
          rejectedReason: `${filePath}:${diagnostic.line} no longer contains ${change.expectedDescription}.`,
        };
      change.expectedPattern.lastIndex = 0;
      const updatedLine = originalLine.replace(change.expectedPattern, change.replacement);
      lines[index] = updatedLine;
      proposalEdits.push({
        path: filePath,
        expectedText: originalLine,
        replacement: updatedLine,
        rationale: change.rationale,
        diagnostic: diagnostic.evidence,
      });
    }
    edits.push({
      path: filePath,
      source,
      updated: lines.join('\n'),
      changedLines: proposalEdits.length,
      evidence: [...new Set(fileDiagnostics.map((diagnostic) => diagnostic.evidence))],
      proposalEdits,
    });
  }
  const changedLines = edits.reduce((total, edit) => total + edit.changedLines, 0);
  if (!changedLines)
    return { edits: [], rejectedReason: `No exact ${change.expectedDescription} was available to repair.` };
  if (changedLines > policy.maxChangedLines)
    return { edits: [], rejectedReason: `The repair would change more than ${policy.maxChangedLines} source lines.` };
  return { edits, rejectedReason: null };
}

async function planRecipe(
  workspacePath: string,
  finding: DependencyFinding,
  candidateResults: CommandResult[],
): Promise<RecipePlan> {
  if (finding.packageName === 'zod') {
    const plan = await planZodIssuesRepair(workspacePath, finding, candidateResults);
    return {
      recipeId: 'zod-v4-errors-to-issues',
      proposal: plan.edits.length
        ? toProposal(
            'zod-v4-errors-to-issues',
            'Replace compiler-attributed Zod v3 error access with the Zod v4 API.',
            plan.edits,
            'https://zod.dev/v4/changelog',
          )
        : null,
      rejectedReason: plan.rejectedReason,
      successRationale: 'The recipe-generated Zod proposal passed every declared repository check.',
    };
  }
  if (finding.packageName === '@tanstack/react-query') {
    const plan = await planTanstackQueryGcTimeRepair(workspacePath, finding, candidateResults);
    return {
      recipeId: 'tanstack-query-v5-cachetime-to-gctime',
      proposal: plan.edits.length
        ? toProposal(
            'tanstack-query-v5-cachetime-to-gctime',
            'Replace the compiler-attributed TanStack Query v4 option with its v5 name.',
            plan.edits,
            'https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5#rename-cachetime-to-gctime',
          )
        : null,
      rejectedReason: plan.rejectedReason,
      successRationale: 'The recipe-generated TanStack Query proposal passed every declared repository check.',
    };
  }
  return { recipeId: null, proposal: null, rejectedReason: null, successRationale: null };
}

function countOccurrences(source: string, expected: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(expected, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, expected.length);
  }
  return count;
}
function changedLineCost(expectedText: string, replacement: string): number {
  return Math.max(expectedText.split('\n').length, replacement.split('\n').length);
}

function forbiddenReplacement(replacement: string): string | null {
  const blocked = [
    /@ts-(?:ignore|nocheck|expect-error)/i,
    /eslint-disable/i,
    /child_process|node:(?:fs|net|http|https|dgram|tls)/i,
    /(?:from\s+|require\s*\(\s*)['"](?:fs|child_process|net|http|https|dgram|tls)['"]/i,
    /\b(?:exec|execFile|execSync|spawn|spawnSync|eval|writeFile|appendFile|unlink|rmSync)\s*\(/,
    /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/,
    /\b(?:Bun|Deno)\./,
    /\bprocess\.exit\s*\(/,
    /\bnew\s+Function\s*\(/,
  ].find((pattern) => pattern.test(replacement));
  return blocked ? 'The replacement contains a blocked suppression, process, network, or filesystem capability.' : null;
}

export async function validateRepairProposal(
  workspacePath: string,
  proposal: RepairProposal,
  context: RepairInvestigationContext,
): Promise<ProposalValidationResult> {
  if (!proposal || (proposal.kind !== 'recipe' && proposal.kind !== 'agent'))
    return { ok: false, reason: 'The proposal kind is invalid.' };
  if (
    typeof proposal.id !== 'string' ||
    !proposal.id.trim() ||
    typeof proposal.summary !== 'string' ||
    !proposal.summary.trim()
  )
    return { ok: false, reason: 'The proposal must include a non-empty id and summary.' };
  if (!Array.isArray(proposal.edits) || proposal.edits.length === 0)
    return { ok: false, reason: 'The proposal contains no edits.' };
  if (!Array.isArray(proposal.evidence) || proposal.evidence.some((item) => typeof item !== 'string'))
    return { ok: false, reason: 'The proposal evidence must be a string array.' };
  const uniquePaths = new Set<string>();
  let changedLines = 0;
  for (const edit of proposal.edits) {
    const normalizedPath = normalizeProposalPath(edit?.path);
    if (!normalizedPath)
      return {
        ok: false,
        reason: `The proposal path ${String(edit?.path)} is not a normalized repository-relative path.`,
      };
    uniquePaths.add(normalizedPath);
    if (uniquePaths.size > policy.maxFiles)
      return { ok: false, reason: `The proposal would touch more than ${policy.maxFiles} source files.` };
    if (!policy.allowedExtensions.includes(path.posix.extname(normalizedPath)))
      return { ok: false, reason: `${normalizedPath} is not an allowed source-file type.` };
    if (forbidden(normalizedPath))
      return {
        ok: false,
        reason: `${normalizedPath} is inside a test, fixture, or migration path, or is configuration.`,
      };
    if (
      typeof edit.expectedText !== 'string' ||
      !edit.expectedText ||
      typeof edit.replacement !== 'string' ||
      edit.expectedText.includes('\0') ||
      edit.replacement.includes('\0')
    )
      return { ok: false, reason: `${normalizedPath} has an imprecise replacement.` };
    if (edit.expectedText.length > MAX_EDIT_TEXT_LENGTH || edit.replacement.length > MAX_EDIT_TEXT_LENGTH)
      return { ok: false, reason: `${normalizedPath} exceeds the maximum exact-edit size.` };
    if (edit.expectedText === edit.replacement) return { ok: false, reason: `${normalizedPath} proposes no change.` };
    const blockedReplacement = forbiddenReplacement(edit.replacement);
    if (blockedReplacement) return { ok: false, reason: `${normalizedPath}: ${blockedReplacement}` };
    if (typeof edit.rationale !== 'string' || !edit.rationale.trim())
      return { ok: false, reason: `${normalizedPath} is missing a rationale.` };
    if (typeof edit.diagnostic !== 'string' || !edit.diagnostic.trim())
      return { ok: false, reason: `${normalizedPath} is missing its supporting diagnostic.` };
    const matchingContext = context.sources.find(
      (source) =>
        source.path === normalizedPath &&
        source.diagnostic === edit.diagnostic &&
        source.content.includes(edit.expectedText),
    );
    if (!matchingContext)
      return {
        ok: false,
        reason: `${normalizedPath} was not proposed from an exact diagnostic context the Agent was allowed to read.`,
      };
    changedLines += changedLineCost(edit.expectedText, edit.replacement);
    if (changedLines > policy.maxChangedLines)
      return { ok: false, reason: `The proposal would change more than ${policy.maxChangedLines} source lines.` };
  }
  const files: ValidatedFileEdit[] = [];
  for (const filePath of uniquePaths) {
    if (!(await isTracked(workspacePath, filePath))) return { ok: false, reason: `${filePath} is not a tracked file.` };
    let source: string;
    try {
      source = await readAllowedSource(workspacePath, filePath);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : `Could not safely read ${filePath}.` };
    }
    const ranges: Array<{ start: number; end: number; edit: RepairEdit }> = [];
    for (const edit of proposal.edits.filter((item) => item.path === filePath)) {
      if (countOccurrences(source, edit.expectedText) !== 1)
        return { ok: false, reason: `${filePath} does not contain the expected text exactly once.` };
      const start = source.indexOf(edit.expectedText);
      ranges.push({ start, end: start + edit.expectedText.length, edit });
    }
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end)
        return { ok: false, reason: `${filePath} contains overlapping edits.` };
    }
    let updated = source;
    for (const range of [...ranges].sort((a, b) => b.start - a.start))
      updated = `${updated.slice(0, range.start)}${range.edit.replacement}${updated.slice(range.end)}`;
    files.push({ path: filePath, source, updated });
  }
  return { ok: true, files, changedLines };
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
    args: ['diff', '--no-ext-diff', '--binary'],
    cwd: workspacePath,
    timeoutMs: 30_000,
    maxOutputBytes: null,
  });
  if (files.status !== 'passed' || patch.status !== 'passed')
    throw new Error(files.output || patch.output || 'Could not capture the repaired patch.');
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
    .map((file) => (file.includes(' -> ') ? file.split(' -> ').at(-1)! : file))
    .filter((file) => file !== 'node_modules/');
}
function attemptWithContext(
  attempt: RepairAttempt,
  context: RepairInvestigationContext,
  proposal: RepairProposal | null = null,
): RepairAttempt {
  return {
    ...attempt,
    proposal,
    proposalSource: proposal?.kind ?? null,
    recipeId: proposal?.kind === 'recipe' ? proposal.id : null,
    contextRead: context.sources,
    releaseEvidence: context.releaseEvidence,
    evidence: proposal?.evidence ?? context.diagnostics,
  };
}

export async function attemptBoundedRepair(input: {
  requested: boolean;
  workspacePath: string;
  finding: DependencyFinding;
  manifest?: PackageManifest;
  checks: ProjectCheck[];
  candidateResults: CommandResult[];
  releaseEvidence?: string[];
  proposalGenerator?: RepairProposalGenerator;
  timeoutMs?: number;
}): Promise<RepairAttempt> {
  if (!input.requested) return emptyRepairAttempt(false, 'not_requested', 'Automatic repair was not requested.');
  const introducedFailures = input.candidateResults.filter(
    (result) => result.status === 'failed' || result.status === 'timed_out',
  );
  if (!introducedFailures.length)
    return emptyRepairAttempt(true, 'not_needed', 'All candidate checks passed; no source repair was needed.');
  const suppliedManifest = input.manifest ?? {};
  const restrictedManifest: PackageManifest = {
    name: suppliedManifest.name,
    version: suppliedManifest.version,
    packageManager: suppliedManifest.packageManager,
    scripts: suppliedManifest.scripts,
    dependencies: suppliedManifest.dependencies,
    devDependencies: suppliedManifest.devDependencies,
    peerDependencies: suppliedManifest.peerDependencies,
    optionalDependencies: suppliedManifest.optionalDependencies,
  };
  const context: RepairInvestigationContext = {
    finding: input.finding,
    diagnostics: collectFailureDiagnostics(input.candidateResults),
    sources: await collectRepairContexts(input.workspacePath, input.candidateResults),
    manifest: restrictedManifest,
    checks: input.checks,
    releaseEvidence: input.releaseEvidence ?? [],
    policy,
  };
  const recipe = await planRecipe(input.workspacePath, input.finding, input.candidateResults);
  if (recipe.rejectedReason) {
    const rejected = attemptWithContext(emptyRepairAttempt(true, 'policy_rejected', recipe.rejectedReason), context);
    return { ...rejected, recipeId: recipe.recipeId, proposalSource: recipe.recipeId ? 'recipe' : null };
  }
  let proposal = recipe.proposal;
  let successRationale = recipe.successRationale;
  if (!proposal) {
    if (!context.sources.length)
      return attemptWithContext(
        emptyRepairAttempt(
          true,
          'unsupported',
          'No allowed tracked source context could be tied to the new diagnostics, so no generic proposal was requested.',
        ),
        context,
      );
    if (!input.proposalGenerator)
      return attemptWithContext(
        emptyRepairAttempt(
          true,
          'agent_unavailable',
          'No model-backed repair-proposal generator is configured. Diagnostics and source context were retained for manual investigation.',
        ),
        context,
      );
    let generation;
    try {
      generation = await input.proposalGenerator(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return attemptWithContext(
        emptyRepairAttempt(
          true,
          'agent_unavailable',
          `The model proposal step was unavailable: ${message}. No source edit was applied.`,
        ),
        context,
      );
    }
    if (generation.status === 'unavailable')
      return attemptWithContext(
        emptyRepairAttempt(true, 'agent_unavailable', `${generation.reason} No source edit was applied.`),
        context,
      );
    if (generation.status === 'no_proposal')
      return attemptWithContext(emptyRepairAttempt(true, 'unsupported', generation.reason), context);
    proposal = generation.proposal;
    if (proposal.kind !== 'agent')
      return attemptWithContext(
        emptyRepairAttempt(
          true,
          'policy_rejected',
          'The generic generator returned a proposal with an invalid source kind.',
        ),
        context,
        proposal,
      );
    successRationale =
      'The model-generated candidate proposal passed deterministic policy validation and every declared repository check. It remains a suggestion requiring human approval.';
  }
  const validation = await validateRepairProposal(input.workspacePath, proposal, context);
  if (!validation.ok)
    return attemptWithContext(emptyRepairAttempt(true, 'policy_rejected', validation.reason), context, proposal);
  for (const file of validation.files) {
    if ((await readAllowedSource(input.workspacePath, file.path)) !== file.source)
      return attemptWithContext(
        emptyRepairAttempt(
          true,
          'policy_rejected',
          `${file.path} changed after proposal validation; the edit was not applied.`,
        ),
        context,
        proposal,
      );
  }
  for (const file of validation.files) await writeFile(path.join(input.workspacePath, file.path), file.updated, 'utf8');
  const diff = await captureDiff(input.workspacePath);
  const allowedChanges = new Set([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    ...validation.files.map((file) => file.path),
  ]);
  const policyViolations = (await statusPaths(input.workspacePath)).filter((file) => !allowedChanges.has(file));
  if (policyViolations.length) {
    const rejected = attemptWithContext(
      emptyRepairAttempt(true, 'policy_rejected', 'The proposed repair produced files outside the allowed patch.'),
      context,
      proposal,
    );
    return {
      ...rejected,
      changedFiles: diff.files,
      changedLines: validation.changedLines,
      patch: diff.patch,
      unexpectedChanges: policyViolations,
    };
  }
  const verificationResults = await runChecks(input.checks, input.workspacePath, input.timeoutMs);
  const diffAfterVerification = await captureDiff(input.workspacePath);
  const verificationChangedPatch = diffAfterVerification.patch !== diff.patch;
  const unexpectedChanges = [
    ...(await statusPaths(input.workspacePath)).filter((file) => !allowedChanges.has(file)),
    ...(verificationChangedPatch ? ['verification scripts altered the proposed patch'] : []),
  ];
  const allDeclaredChecksPassed = verificationResults
    .filter((result) => input.checks.find((check) => check.name === result.name)?.available)
    .every((result) => result.status === 'passed');
  const verified = allDeclaredChecksPassed && unexpectedChanges.length === 0;
  const completed = attemptWithContext(
    emptyRepairAttempt(
      true,
      verified ? 'verified' : 'failed_verification',
      verified
        ? (successRationale ?? 'The candidate proposal passed every declared repository check.')
        : 'The candidate proposal was applied only in the disposable clone, but it did not pass every safety condition.',
    ),
    context,
    proposal,
  );
  return {
    ...completed,
    changedFiles: diff.files,
    changedLines: validation.changedLines,
    patch: diff.patch,
    verificationResults,
    unexpectedChanges,
  };
}
