import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAIProposalGenerator, describeModelConfig, resolveModelConfig } from '../agent/openai';
import { renderIsolatedUpgradeReport } from '../core/report';
import type { IsolatedUpgradeReport, PackageManifest } from '../core/types';
import type { IsolatedUpgradeOptions } from '../core/upgrade';
import { commentMarker, formatOutputAssignments, renderPullRequestComment } from './comment';
import { readGitHubContext, type GitHubContext } from './context';
import { detectDependencyChange } from './detect';
import { upsertPullRequestComment } from './github';
import { readActionInputs, validatePackageName, validateTargetVersion, type ActionInputs } from './inputs';
import { prepareSourceCheckout } from './source';

/**
 * Orchestrates one GitHub Action run: decide which upgrade to investigate, run
 * the CLI core in isolation, and publish the report as job summary, artifact
 * files, outputs, and (optionally) one pull-request comment. It never writes
 * to the repository, never commits, and never pushes.
 */

export interface ActionRunDependencies {
  upgrade: (options: IsolatedUpgradeOptions) => Promise<IsolatedUpgradeReport>;
  prepareSource: typeof prepareSourceCheckout;
  fetchImpl: typeof fetch;
  readEventFile?: (filePath: string) => Promise<string>;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export type ActionOutcome =
  | { status: 'completed'; report: IsolatedUpgradeReport; reportDir: string; comment: 'created' | 'updated' | 'skipped' | 'failed' }
  | { status: 'skipped'; reason: string };

interface Target {
  packageName: string;
  targetVersion: string;
  origin: 'inputs' | 'pull_request';
}

const summaryLimit = 900_000;

async function parseManifest(filePath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(filePath, 'utf8')) as PackageManifest;
}

function targetFromInputs(inputs: ActionInputs): Target | null {
  if (!inputs.packageName && !inputs.targetVersion) return null;
  if (!inputs.packageName || !inputs.targetVersion) throw new Error('Provide both `package` and `version` inputs, or neither to detect the change from a pull request.');
  const packageName = validatePackageName(inputs.packageName);
  if (!packageName.ok) throw new Error(packageName.message);
  const targetVersion = validateTargetVersion(inputs.targetVersion);
  if (!targetVersion.ok) throw new Error(targetVersion.message);
  return { packageName: packageName.value, targetVersion: targetVersion.value, origin: 'inputs' };
}

async function appendSummary(env: Record<string, string | undefined>, markdown: string): Promise<void> {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const bounded = markdown.length > summaryLimit ? `${markdown.slice(0, summaryLimit)}\n\n… (summary truncated; the complete report is in the artifact)\n` : markdown;
  await appendFile(env.GITHUB_STEP_SUMMARY, `${bounded}\n`, 'utf8');
}

async function writeOutputs(env: Record<string, string | undefined>, entries: Record<string, string>): Promise<void> {
  if (!env.GITHUB_OUTPUT) return;
  await appendFile(env.GITHUB_OUTPUT, formatOutputAssignments(entries), 'utf8');
}

async function publishComment(
  context: GitHubContext,
  env: Record<string, string | undefined>,
  inputs: ActionInputs,
  report: IsolatedUpgradeReport,
  deps: ActionRunDependencies,
): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
  const token = env.GITHUB_TOKEN?.trim();
  if (!inputs.comment || !context.pullRequest || !context.repository || !token) return 'skipped';
  try {
    const result = await upsertPullRequestComment(
      { apiUrl: context.apiUrl, repository: context.repository, pullNumber: context.pullRequest.number, token },
      renderPullRequestComment(report, { runUrl: context.runUrl }),
      commentMarker,
      deps.fetchImpl,
    );
    deps.log(`Pull request comment ${result.action} (#${context.pullRequest.number}).`);
    return result.action;
  } catch (error) {
    deps.warn(`Could not publish the pull request comment (the job summary and artifact still carry the report): ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}

export async function runAction(env: Record<string, string | undefined>, deps: ActionRunDependencies): Promise<ActionOutcome> {
  const inputs = readActionInputs(env);
  const context = await readGitHubContext(env, deps.readEventFile);
  const workspace = context.workspace ?? process.cwd();
  if (!path.isAbsolute(workspace)) throw new Error('GITHUB_WORKSPACE must be an absolute path.');
  const reportDir = path.join(workspace, inputs.outputDir);
  const modelConfig = resolveModelConfig(env);
  deps.log(`Model for generic proposals: ${describeModelConfig(modelConfig)}.`);

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'depsherpa-action-'));
  try {
    let target = targetFromInputs(inputs);
    let repoPath = workspace;

    if (context.pullRequest) {
      const source = await deps.prepareSource({ workspace, temporaryRoot, sha: context.pullRequest.baseSha });
      repoPath = source.path;
      deps.log(`Investigating from the pull request base ${source.sha.slice(0, 7)}.`);
      if (!target) {
        const detection = detectDependencyChange(await parseManifest(path.join(source.path, 'package.json')), await parseManifest(path.join(workspace, 'package.json')));
        if (!detection.ok) {
          const reason = detection.changes.length ? `${detection.reason}\n\nDetected changes:\n${detection.changes.map((change) => `- ${change}`).join('\n')}` : detection.reason;
          await appendSummary(env, `## DepSherpa\n\nNo isolated upgrade was run. ${reason}\n`);
          await writeOutputs(env, { verdict: 'skipped', 'repair-status': 'not_run', 'report-dir': '' });
          deps.log(`Skipped: ${detection.reason}`);
          return { status: 'skipped', reason: detection.reason };
        }
        target = { packageName: detection.change.packageName, targetVersion: detection.change.targetVersion, origin: 'pull_request' };
        deps.log(`Detected ${detection.change.section}.${detection.change.packageName}: ${detection.change.fromRange} → ${detection.change.toRange} (exact target ${detection.change.targetVersion}).`);
      }
    }

    if (!target) {
      const reason = 'No pull request context and no `package`/`version` inputs were provided, so there is nothing to investigate.';
      await appendSummary(env, `## DepSherpa\n\n${reason}\n`);
      await writeOutputs(env, { verdict: 'skipped', 'repair-status': 'not_run', 'report-dir': '' });
      deps.log(`Skipped: ${reason}`);
      return { status: 'skipped', reason };
    }

    deps.log(`Running the isolated upgrade of ${target.packageName} to ${target.targetVersion} (repair ${inputs.attemptRepair ? 'requested' : 'not requested'}).`);
    const report = await deps.upgrade({
      repoPath,
      packageName: target.packageName,
      targetVersion: target.targetVersion,
      attemptRepair: inputs.attemptRepair,
      keepWorkspace: false,
      proposalGenerator: createOpenAIProposalGenerator(modelConfig),
    });

    const markdown = renderIsolatedUpgradeReport(report);
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(path.join(reportDir, 'report.md'), markdown, 'utf8');
    if (report.patch) await writeFile(path.join(reportDir, 'candidate.patch'), `${report.patch}\n`, 'utf8');
    await appendSummary(env, markdown);
    await writeOutputs(env, {
      verdict: report.verdict,
      'repair-status': report.repair.status,
      'report-dir': inputs.outputDir,
      package: target.packageName,
      'target-version': target.targetVersion,
    });
    deps.log(`Verdict: ${report.verdict} · repair: ${report.repair.status} · ${report.changedFiles.length} file(s) changed in the disposable clone.`);
    const comment = await publishComment(context, env, inputs, report, deps);
    return { status: 'completed', report, reportDir, comment };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
