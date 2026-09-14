import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { commentMarker } from './action/comment.js';
import { contextFromGitHub } from './action/context.js';
import { upsertPullRequestComment } from './action/github.js';
import { readActionInputs } from './action/inputs.js';
import { runAction, type ActionOutcome } from './action/run.js';
import { prepareSourceCheckout } from './action/source.js';
import { upgradeInIsolation } from './core/upgrade.js';

export const artifactName = 'depsherpa-report';

async function uploadReportArtifact(outcome: Extract<ActionOutcome, { status: 'completed' }>): Promise<void> {
  try {
    const client = new DefaultArtifactClient();
    const { id } = await client.uploadArtifact(artifactName, outcome.reportFiles.files, outcome.reportFiles.directory);
    core.info(`Uploaded the ${artifactName} artifact${id ? ` (id ${id})` : ''}.`);
  } catch (error) {
    core.warning(
      `Could not upload the report artifact; the job summary still carries the report: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const inputs = readActionInputs((name) => core.getInput(name));
    if (inputs.openaiApiKey) core.setSecret(inputs.openaiApiKey);
    const context = contextFromGitHub(github.context, process.env);

    const octokit = inputs.githubToken ? github.getOctokit(inputs.githubToken) : null;
    const [owner, repo] = context.repository?.split('/') ?? [];
    const pullNumber = context.pullRequest?.number;
    const publishComment =
      octokit && owner && repo && pullNumber
        ? (body: string) =>
            upsertPullRequestComment(
              octokit.rest.issues,
              { owner, repo, issueNumber: pullNumber },
              body,
              commentMarker,
            ).then((result) => result.action)
        : null;

    const outcome = await runAction(
      { inputs, context, env: process.env },
      {
        upgrade: upgradeInIsolation,
        prepareSource: prepareSourceCheckout,
        publishComment,
        writeSummary: async (markdown) => {
          await core.summary.addRaw(markdown).write();
        },
        setOutput: (name, value) => core.setOutput(name, value),
        log: (message) => core.info(message),
        warn: (message) => core.warning(message),
      },
    );

    if (outcome.status === 'skipped') {
      core.notice(`DepSherpa skipped: ${outcome.reason}`);
      return;
    }
    if (inputs.uploadArtifact) await uploadReportArtifact(outcome);
  } catch (error) {
    // Fail the workflow run only for invalid inputs or infrastructure errors; never for a verdict.
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
