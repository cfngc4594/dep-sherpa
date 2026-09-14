/**
 * Unit tests for the action's main functionality, src/main.ts.
 *
 * `@actions/core`, `@actions/github`, `@actions/artifact`, and the orchestration
 * module are mocked so the wiring can be verified without a runner.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import { sampleIsolatedUpgradeReport } from '../__fixtures__/report.js';
import type { IssuesApi } from '../src/action/github.js';
import type { ActionOutcome, ActionRunDependencies, ActionRunInput } from '../src/action/run.js';

const runAction = jest.fn<(input: ActionRunInput, deps: ActionRunDependencies) => Promise<ActionOutcome>>();
const uploadArtifact = jest.fn<(name: string, files: string[], rootDirectory: string) => Promise<{ id?: number }>>();
const issues = {
  listComments: jest.fn<IssuesApi['listComments']>(async () => ({ data: [] })),
  createComment: jest.fn<IssuesApi['createComment']>(async () => ({ data: { id: 900 } })),
  updateComment: jest.fn<IssuesApi['updateComment']>(async () => ({ data: { id: 900 } })),
};
const getOctokit = jest.fn<(token: string) => { rest: { issues: IssuesApi } }>(() => ({ rest: { issues } }));
const githubContext = {
  eventName: 'pull_request',
  payload: { pull_request: { number: 7, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } },
  runId: 55,
  serverUrl: 'https://github.com',
  repo: { owner: 'acme', repo: 'sample' },
};

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core);
jest.unstable_mockModule('@actions/github', () => ({ context: githubContext, getOctokit }));
jest.unstable_mockModule('@actions/artifact', () => ({
  DefaultArtifactClient: class {
    uploadArtifact = uploadArtifact;
  },
}));
jest.unstable_mockModule('../src/action/run.js', () => ({ runAction }));

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run, artifactName } = await import('../src/main.js');

const inputs: Record<string, string> = {
  package: '',
  version: '',
  'attempt-repair': 'true',
  comment: 'true',
  'upload-artifact': 'true',
  'report-dir': 'depsherpa-report',
  model: '',
  'openai-base-url': '',
  'openai-api-key': 'sk-secret',
  'github-token': 'ghs_token',
};

describe('main.ts', () => {
  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => inputs[name] ?? '');
    process.env.GITHUB_WORKSPACE = '/work';
  });

  afterEach(() => {
    jest.resetAllMocks();
    core.summaryWrites.length = 0;
    delete process.env.GITHUB_WORKSPACE;
  });

  it('wires inputs, context, and the toolkit sinks into the orchestration and uploads the artifact', async () => {
    const report = sampleIsolatedUpgradeReport();
    runAction.mockResolvedValueOnce({
      status: 'completed',
      report,
      reportFiles: { directory: '/work/depsherpa-report', files: ['/work/depsherpa-report/report.json'] },
      comment: 'created',
    });
    uploadArtifact.mockResolvedValueOnce({ id: 1 });

    await run();

    expect(core.setSecret).toHaveBeenCalledWith('sk-secret');
    expect(runAction).toHaveBeenCalledTimes(1);
    const [input, deps] = runAction.mock.calls[0];
    expect(input.inputs).toMatchObject({
      attemptRepair: true,
      comment: true,
      uploadArtifact: true,
      openaiApiKey: 'sk-secret',
      githubToken: 'ghs_token',
    });
    expect(input.context).toMatchObject({
      eventName: 'pull_request',
      repository: 'acme/sample',
      runUrl: 'https://github.com/acme/sample/actions/runs/55',
      workspace: '/work',
      pullRequest: { number: 7 },
    });
    expect(getOctokit).toHaveBeenCalledWith('ghs_token');

    // Sinks forward to @actions/core.
    await deps.writeSummary('# summary');
    deps.setOutput('verdict', 'blocked');
    deps.log('hello');
    deps.warn('careful');
    expect(core.summaryWrites).toEqual(['# summary']);
    expect(core.setOutput).toHaveBeenCalledWith('verdict', 'blocked');
    expect(core.info).toHaveBeenCalledWith('hello');
    expect(core.warning).toHaveBeenCalledWith('careful');

    // The comment publisher goes through Octokit and creates the marked comment.
    expect(deps.publishComment).not.toBeNull();
    await expect(deps.publishComment!('<!-- depsherpa:report -->\nbody')).resolves.toBe('created');
    expect(issues.createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'sample',
      issue_number: 7,
      body: '<!-- depsherpa:report -->\nbody',
    });

    expect(uploadArtifact).toHaveBeenCalledWith(
      artifactName,
      ['/work/depsherpa-report/report.json'],
      '/work/depsherpa-report',
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('records a notice and uploads nothing when the run was skipped', async () => {
    runAction.mockResolvedValueOnce({ status: 'skipped', reason: 'nothing to investigate' });
    await run();
    expect(core.notice).toHaveBeenCalledWith('DepSherpa skipped: nothing to investigate');
    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('turns an artifact upload failure into a warning, not a failed run', async () => {
    runAction.mockResolvedValueOnce({
      status: 'completed',
      report: sampleIsolatedUpgradeReport(),
      reportFiles: { directory: '/work/depsherpa-report', files: [] },
      comment: 'skipped',
    });
    uploadArtifact.mockRejectedValueOnce(new Error('Unable to get the ACTIONS_RUNTIME_TOKEN env variable'));
    await run();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ACTIONS_RUNTIME_TOKEN'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('skips Octokit entirely without a token and fails the run only on thrown errors', async () => {
    core.getInput.mockImplementation((name: string) => (name === 'github-token' ? '' : (inputs[name] ?? '')));
    runAction.mockRejectedValueOnce(new Error('version must be an exact semantic version'));
    await run();
    expect(getOctokit).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith('version must be an exact semantic version');
  });
});
