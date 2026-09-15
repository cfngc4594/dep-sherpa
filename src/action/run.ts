import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAIProposalGenerator, describeModelConfig, resolveModelConfig } from '../agent/openai.js';
import { renderIsolatedUpgradeReport } from '../core/report.js';
import type { IsolatedUpgradeReport, PackageManifest } from '../core/types.js';
import type { IsolatedUpgradeOptions } from '../core/upgrade.js';
import { workflowDiagnosticAnnotations } from './annotations.js';
import { renderPullRequestComment } from './comment.js';
import type { GitHubContext } from './context.js';
import { detectDependencyChange } from './detect.js';
import { modelEnvironment, validatePackageName, validateTargetVersion, type ActionInputs } from './inputs.js';
import type { prepareSourceCheckout } from './source.js';

/**
 * Orchestrates one GitHub Action run: decide which upgrade to investigate, run
 * the CLI core in isolation, and publish the report through the injected
 * sinks (job summary, outputs, report files, and at most one PR comment). It
 * never writes to the repository, never commits, and never pushes.
 */

export interface ActionRunInput {
  inputs: ActionInputs;
  context: GitHubContext;
  env: Record<string, string | undefined>;
}

export interface ActionRunDependencies {
  upgrade: (options: IsolatedUpgradeOptions) => Promise<IsolatedUpgradeReport>;
  prepareSource: typeof prepareSourceCheckout;
  /** Creates or updates the single PR comment; null when no pull request or token is available. */
  publishComment: ((body: string) => Promise<'created' | 'updated'>) | null;
  writeSummary: (markdown: string) => Promise<void>;
  setOutput: (name: string, value: string) => void;
  log: (message: string) => void;
  warn: (message: string) => void;
  warnAt: (message: string, location: { file: string; startLine: number; endLine?: number }) => void;
}

export interface ReportFiles {
  directory: string;
  files: string[];
}

export type ActionOutcome =
  | {
      status: 'completed';
      report: IsolatedUpgradeReport;
      reportFiles: ReportFiles;
      comment: 'created' | 'updated' | 'skipped' | 'failed';
    }
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
  if (!inputs.packageName || !inputs.targetVersion) {
    throw new Error(
      'Provide both `package` and `version` inputs, or neither to detect the change from a pull request.',
    );
  }
  const packageName = validatePackageName(inputs.packageName);
  if (!packageName.ok) throw new Error(packageName.message);
  const targetVersion = validateTargetVersion(inputs.targetVersion);
  if (!targetVersion.ok) throw new Error(targetVersion.message);
  return { packageName: packageName.value, targetVersion: targetVersion.value, origin: 'inputs' };
}

function boundedSummary(markdown: string): string {
  return markdown.length > summaryLimit
    ? `${markdown.slice(0, summaryLimit)}\n\n… (summary truncated; the complete report is in the artifact)\n`
    : markdown;
}

async function skip(reason: string, detail: string, deps: ActionRunDependencies): Promise<ActionOutcome> {
  await deps.writeSummary(`## DepSherpa\n\nNo isolated upgrade was run. ${detail}\n`);
  deps.setOutput('verdict', 'skipped');
  deps.setOutput('repair-status', 'not_run');
  deps.setOutput('report-dir', '');
  deps.log(`Skipped: ${reason}`);
  return { status: 'skipped', reason };
}

async function publishComment(
  input: ActionRunInput,
  report: IsolatedUpgradeReport,
  deps: ActionRunDependencies,
): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
  if (!input.inputs.comment || !input.context.pullRequest || !deps.publishComment) return 'skipped';
  try {
    const action = await deps.publishComment(renderPullRequestComment(report, { runUrl: input.context.runUrl }));
    deps.log(`Pull request comment ${action} (#${input.context.pullRequest.number}).`);
    return action;
  } catch (error) {
    deps.warn(
      `Could not publish the pull request comment (the job summary and artifact still carry the report): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 'failed';
  }
}

export async function runAction(input: ActionRunInput, deps: ActionRunDependencies): Promise<ActionOutcome> {
  const { inputs, context } = input;
  const workspace = context.workspace ?? process.cwd();
  if (!path.isAbsolute(workspace)) throw new Error('GITHUB_WORKSPACE must be an absolute path.');
  const reportDirectory = path.join(workspace, inputs.outputDir);
  const modelConfig = resolveModelConfig(modelEnvironment(inputs, input.env));
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
        const detection = detectDependencyChange(
          await parseManifest(path.join(source.path, 'package.json')),
          await parseManifest(path.join(workspace, 'package.json')),
        );
        if (!detection.ok) {
          const detail = detection.changes.length
            ? `${detection.reason}\n\nDetected changes:\n${detection.changes.map((change) => `- ${change}`).join('\n')}`
            : detection.reason;
          return skip(detection.reason, detail, deps);
        }
        target = {
          packageName: detection.change.packageName,
          targetVersion: detection.change.targetVersion,
          origin: 'pull_request',
        };
        deps.log(
          `Detected ${detection.change.section}.${detection.change.packageName}: ${detection.change.fromRange} → ${detection.change.toRange} (exact target ${detection.change.targetVersion}).`,
        );
      }
    }

    if (!target) {
      const reason =
        'No pull request context and no `package`/`version` inputs were provided, so there is nothing to investigate.';
      return skip(reason, reason, deps);
    }

    deps.log(
      `Running the isolated upgrade of ${target.packageName} to ${target.targetVersion} (repair ${
        inputs.attemptRepair ? 'requested' : 'not requested'
      }).`,
    );
    const report = await deps.upgrade({
      repoPath,
      packageName: target.packageName,
      targetVersion: target.targetVersion,
      attemptRepair: inputs.attemptRepair,
      keepWorkspace: false,
      proposalGenerator: createOpenAIProposalGenerator(modelConfig),
    });

    const markdown = renderIsolatedUpgradeReport(report);
    await mkdir(reportDirectory, { recursive: true });
    const files = [path.join(reportDirectory, 'report.json'), path.join(reportDirectory, 'report.md')];
    await writeFile(files[0], `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(files[1], markdown, 'utf8');
    if (report.patch) {
      files.push(path.join(reportDirectory, 'candidate.patch'));
      await writeFile(files[2], `${report.patch}\n`, 'utf8');
    }
    await deps.writeSummary(boundedSummary(markdown));
    deps.setOutput('verdict', report.verdict);
    deps.setOutput('repair-status', report.repair.status);
    deps.setOutput('report-dir', inputs.outputDir);
    deps.setOutput('package', target.packageName);
    deps.setOutput('target-version', target.targetVersion);
    deps.log(
      `Verdict: ${report.verdict} · repair: ${report.repair.status} · ${report.changedFiles.length} file(s) changed in the disposable clone.`,
    );
    for (const annotation of workflowDiagnosticAnnotations(report)) {
      deps.warnAt(annotation.message, {
        file: annotation.file,
        startLine: annotation.startLine,
        endLine: annotation.endLine,
      });
    }
    const comment = await publishComment(input, report, deps);
    return { status: 'completed', report, reportFiles: { directory: reportDirectory, files }, comment };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
