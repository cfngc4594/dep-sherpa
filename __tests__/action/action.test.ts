import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { sampleIsolatedUpgradeReport, sampleRepairAttempt } from '../../__fixtures__/report.js';
import { workflowDiagnosticAnnotations } from '../../src/action/annotations.js';
import { commentMarker, renderPullRequestComment } from '../../src/action/comment.js';
import { renderInvestigationMermaid } from '../../src/action/pipeline-diagram.js';
import { contextFromGitHub, pullRequestFromPayload, type GitHubContext } from '../../src/action/context.js';
import { detectDependencyChange, exactVersionFromRange } from '../../src/action/detect.js';
import { upsertPullRequestComment, type IssuesApi } from '../../src/action/github.js';
import {
  modelEnvironment,
  parseBooleanInput,
  parseFailOn,
  readActionInputs,
  validatePackageName,
  validateTargetVersion,
  type ActionInputs,
} from '../../src/action/inputs.js';
import { runAction, type ActionRunDependencies } from '../../src/action/run.js';
import { prepareSourceCheckout } from '../../src/action/source.js';
import { renderIsolatedUpgradeReport } from '../../src/core/report.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', ['-c', 'user.name=DepSherpa', '-c', 'user.email=test@depsherpa.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

/**
 * Builds what a runner sees for a Dependabot-style pull request: an origin with
 * a base commit and a bump commit, checked out shallowly at the bump.
 */
async function pullRequestWorkspace() {
  const root = await temporaryDirectory('depsherpa-action-test-');
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  execFileSync('git', ['init', '--quiet', '--bare', origin]);
  git(['config', 'uploadpack.allowReachableSHA1InWant', 'true'], origin);
  execFileSync('git', ['init', '--quiet', '-b', 'main', seed]);
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({ name: 'sample', dependencies: { zod: '3.23.8' }, scripts: { test: 'node -e 0' } }, null, 2),
  );
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  git(['add', '.'], seed);
  git(['commit', '--quiet', '-m', 'baseline'], seed);
  const baseSha = git(['rev-parse', 'HEAD'], seed);
  git(['checkout', '--quiet', '-b', 'dependabot/npm_and_yarn/zod-4.1.5'], seed);
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({ name: 'sample', dependencies: { zod: '^4.1.5' }, scripts: { test: 'node -e 0' } }, null, 2),
  );
  git(['commit', '--quiet', '-am', 'chore(deps): bump zod'], seed);
  const headSha = git(['rev-parse', 'HEAD'], seed);
  git(['remote', 'add', 'origin', origin], seed);
  git(['push', '--quiet', 'origin', 'main', 'dependabot/npm_and_yarn/zod-4.1.5'], seed);

  const workspace = path.join(root, 'workspace');
  // A file:// URL forces a genuinely shallow clone; plain paths ignore --depth.
  execFileSync('git', [
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    'dependabot/npm_and_yarn/zod-4.1.5',
    `file://${origin}`,
    workspace,
  ]);
  expect(git(['rev-parse', '--is-shallow-repository'], workspace)).toBe('true');

  const context: GitHubContext = {
    eventName: 'pull_request',
    repository: 'acme/sample',
    runUrl: 'https://github.com/acme/sample/actions/runs/123',
    workspace,
    pullRequest: { number: 7, baseSha, headSha, baseRef: 'main', headRef: 'dependabot/npm_and_yarn/zod-4.1.5' },
  };
  return { root, workspace, baseSha, headSha, context };
}

const defaultInputs: ActionInputs = {
  packageName: null,
  targetVersion: null,
  attemptRepair: true,
  comment: true,
  uploadArtifact: true,
  outputDir: 'depsherpa-report',
  model: null,
  openaiBaseUrl: null,
  openaiApiKey: null,
  githubToken: 'ghs_test',
  failOn: new Set(),
};

function inputReader(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? '';
}

function fakeIssues(existing: Array<{ id: number; body: string }> = []) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const issues: IssuesApi = {
    listComments: async (params) => {
      calls.push({ method: 'listComments', params });
      return { data: existing };
    },
    createComment: async (params) => {
      calls.push({ method: 'createComment', params });
      return { data: { id: 900 } };
    },
    updateComment: async (params) => {
      calls.push({ method: 'updateComment', params });
      return { data: { id: params.comment_id } };
    },
  };
  return { issues, calls };
}

interface Sinks {
  summary: string[];
  outputs: Record<string, string>;
  comments: string[];
  warnings: string[];
  annotations: Array<{ message: string; file: string; startLine: number }>;
}

function dependencies(overrides: Partial<ActionRunDependencies> = {}) {
  const sinks: Sinks = { summary: [], outputs: {}, comments: [], warnings: [], annotations: [] };
  const upgrade = jest.fn<ActionRunDependencies['upgrade']>(async () => sampleIsolatedUpgradeReport());
  const deps: ActionRunDependencies = {
    upgrade,
    prepareSource: prepareSourceCheckout,
    publishComment: async (body) => {
      sinks.comments.push(body);
      return 'created';
    },
    writeSummary: async (markdown) => {
      sinks.summary.push(markdown);
    },
    setOutput: (name, value) => {
      sinks.outputs[name] = value;
    },
    log: () => {},
    warn: (message) => {
      sinks.warnings.push(message);
    },
    warnAt: (message, location) => {
      sinks.annotations.push({ message, file: location.file, startLine: location.startLine });
    },
    ...overrides,
  };
  return { deps, upgrade, sinks };
}

describe('action inputs and context', () => {
  it('parses booleans strictly and rejects escaping report directories', () => {
    expect(parseBooleanInput('true', false)).toBe(true);
    expect(parseBooleanInput('FALSE', true)).toBe(false);
    expect(parseBooleanInput('', false)).toBe(false);
    expect(() => parseBooleanInput('maybe', true)).toThrow('boolean');
    expect(readActionInputs(inputReader({ package: ' zod ', version: '4.1.5', 'github-token': 't' }))).toEqual({
      ...defaultInputs,
      packageName: 'zod',
      targetVersion: '4.1.5',
      githubToken: 't',
    });
    expect(() => readActionInputs(inputReader({ 'report-dir': '../outside' }))).toThrow('relative path');
    expect(() => readActionInputs(inputReader({ 'report-dir': '/etc' }))).toThrow('relative path');
  });

  it('parses fail-on verdict lists and rejects unknown tokens', () => {
    expect(parseFailOn('')).toEqual(new Set());
    expect(parseFailOn('needs_repair, blocked')).toEqual(new Set(['needs_repair', 'blocked']));
    expect(readActionInputs(inputReader({ 'fail-on': 'inconclusive' })).failOn).toEqual(new Set(['inconclusive']));
    expect(() => parseFailOn('needs_repair,skipped')).toThrow('unknown verdict');
  });

  it('accepts only valid npm names and exact versions', () => {
    expect(validatePackageName('@tanstack/react-query')).toEqual({ ok: true, value: '@tanstack/react-query' });
    for (const name of ['Zod', '../zod', 'zod; rm -rf /', 'zod@4', '', '$(whoami)']) {
      expect(validatePackageName(name).ok).toBe(false);
    }
    expect(validateTargetVersion('v4.1.5')).toEqual({ ok: true, value: '4.1.5' });
    for (const version of ['^4.1.5', '~4.1.0', 'latest', '4', '4.1.x', '>=4.0.0', '']) {
      expect(validateTargetVersion(version).ok).toBe(false);
    }
  });

  it('lets workflow inputs choose the model endpoint over ambient variables', () => {
    const env = modelEnvironment(
      { ...defaultInputs, openaiApiKey: 'sk-input', openaiBaseUrl: 'https://llm.example/v1', model: 'qwen' },
      { OPENAI_API_KEY: 'sk-env', PATH: '/usr/bin' },
    );
    expect(env).toMatchObject({
      OPENAI_API_KEY: 'sk-input',
      OPENAI_BASE_URL: 'https://llm.example/v1',
      OPENAI_MODEL: 'qwen',
      DEPSHERPA_MODEL: 'qwen',
      PATH: '/usr/bin',
    });
    expect(modelEnvironment(defaultInputs, { OPENAI_API_KEY: 'sk-env' })).toEqual({ OPENAI_API_KEY: 'sk-env' });
    expect(
      modelEnvironment(
        { ...defaultInputs, openaiApiKey: 'sk-input' },
        { OPENAI_BASE_URL: 'https://override.example', OPENAI_MODEL: 'override-model' },
      ),
    ).toMatchObject({
      OPENAI_BASE_URL: 'https://override.example',
      OPENAI_MODEL: 'override-model',
      DEPSHERPA_MODEL: 'override-model',
    });
    expect(modelEnvironment({ ...defaultInputs, openaiApiKey: 'sk-input' }, {})).toMatchObject({
      OPENAI_API_KEY: 'sk-input',
    });
  });

  it('reads the pull request context only from a well-formed event payload', () => {
    const sha = 'a'.repeat(40);
    expect(
      pullRequestFromPayload({
        pull_request: { number: 3, base: { sha, ref: 'main' }, head: { sha: 'b'.repeat(40), ref: 'bump' } },
      }),
    ).toEqual({
      number: 3,
      baseSha: sha,
      headSha: 'b'.repeat(40),
      baseRef: 'main',
      headRef: 'bump',
    });
    expect(pullRequestFromPayload({ pull_request: { number: 3, base: { sha: 'main' }, head: { sha } } })).toBeNull();
    expect(pullRequestFromPayload({ issue: { number: 3 } })).toBeNull();

    const context = contextFromGitHub(
      {
        eventName: 'pull_request',
        payload: { pull_request: { number: 9, base: { sha }, head: { sha } } },
        runId: 42,
        serverUrl: 'https://github.com',
        repo: { owner: 'acme', repo: 'app' },
      },
      { GITHUB_WORKSPACE: '/work' },
    );
    expect(context).toEqual({
      eventName: 'pull_request',
      repository: 'acme/app',
      runUrl: 'https://github.com/acme/app/actions/runs/42',
      workspace: '/work',
      pullRequest: { number: 9, baseSha: sha, headSha: sha, baseRef: null, headRef: null },
    });
    const push = contextFromGitHub(
      {
        eventName: 'push',
        payload: {},
        runId: 0,
        serverUrl: 'https://github.com',
        repo: { owner: 'acme', repo: 'app' },
      },
      {},
    );
    expect(push.pullRequest).toBeNull();
    expect(push.runUrl).toBeNull();
    const outside = contextFromGitHub(
      {
        eventName: '',
        payload: {},
        runId: 0,
        serverUrl: 'https://github.com',
        get repo(): { owner: string; repo: string } {
          throw new Error('context.repo requires GITHUB_REPOSITORY');
        },
      },
      {},
    );
    expect(outside.repository).toBeNull();
  });
});

describe('dependency change detection', () => {
  it('finds the single upgraded dependency and its exact target', () => {
    const detection = detectDependencyChange(
      { dependencies: { zod: '^3.23.8', react: '19.0.0' } },
      { dependencies: { zod: '^4.1.5', react: '19.0.0' } },
    );
    expect(detection).toEqual({
      ok: true,
      change: {
        packageName: 'zod',
        section: 'dependencies',
        fromRange: '^3.23.8',
        toRange: '^4.1.5',
        targetVersion: '4.1.5',
      },
    });
    expect(exactVersionFromRange('4.1.5')).toBe('4.1.5');
    expect(exactVersionFromRange('~5.0.1')).toBe('5.0.1');
    expect(exactVersionFromRange('workspace:*')).toBeNull();
  });

  it('refuses grouped, added, removed, or unresolvable changes', () => {
    expect(
      detectDependencyChange({ dependencies: { zod: '^3.0.0' } }, { dependencies: { zod: '^3.0.0' } }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining('does not change'),
    });
    expect(
      detectDependencyChange(
        { dependencies: { a: '1.0.0', b: '1.0.0' } },
        { dependencies: { a: '2.0.0', b: '2.0.0' } },
      ),
    ).toMatchObject({ ok: false, changes: ['dependencies.a: 1.0.0 → 2.0.0', 'dependencies.b: 1.0.0 → 2.0.0'] });
    expect(detectDependencyChange({ dependencies: {} }, { dependencies: { a: '2.0.0' } })).toMatchObject({ ok: false });
    expect(
      detectDependencyChange({ devDependencies: { a: '1.0.0' } }, { devDependencies: { a: 'latest' } }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining('exact version'),
    });
  });
});

describe('workflow annotations and pipeline diagram', () => {
  it('maps repair context to repository-relative file annotations', () => {
    const report = sampleIsolatedUpgradeReport();
    expect(workflowDiagnosticAnnotations(report)).toEqual([
      {
        file: 'src/validation.ts',
        startLine: 4,
        endLine: 4,
        message: expect.stringContaining("Property 'errors'"),
      },
    ]);
  });

  it('renders a mermaid stage diagram for comments', () => {
    const diagram = renderInvestigationMermaid(sampleIsolatedUpgradeReport());
    expect(diagram).toContain('```mermaid');
    expect(diagram).toContain('flowchart LR');
    expect(diagram).toContain('verdict repaired');
  });
});

describe('pull request comment', () => {
  it('summarizes the report, marks model output as a suggestion, and never offers to apply anything', () => {
    const report = sampleIsolatedUpgradeReport({
      repair: sampleRepairAttempt({
        proposal: { kind: 'agent', id: 'agent-1', summary: 's', evidence: [], edits: [] },
        proposalSource: 'agent',
        recipeId: null,
      }),
    });
    const body = renderPullRequestComment(report, { runUrl: 'https://github.com/acme/app/actions/runs/1' });
    expect(body.startsWith(commentMarker)).toBe(true);
    expect(body).toContain('```mermaid');
    expect(body).toContain('`zod` 3.23.8 → 4.1.5 — **repaired · ready for review**');
    expect(body).toContain('| typecheck | passed | failed | introduced failure |');
    expect(body).toContain('model proposal `agent-1` (a suggestion, not a guarantee)');
    expect(body).toContain('not a correctness guarantee');
    expect(body).toContain('```diff');
    expect(body).toContain('Human decision required');
    expect(body).toContain('https://github.com/acme/app/actions/runs/1');
    expect(body).not.toMatch(/apply this patch automatically|auto-merge|approved/i);
  });

  it('explains blocked runs and truncates oversized patches', () => {
    const report = sampleIsolatedUpgradeReport({
      verdict: 'blocked',
      preparation: {
        name: 'prepare_dependencies',
        command: 'npm ci',
        status: 'failed',
        exitCode: 1,
        durationMs: 1,
        output: 'npm ERR! ERESOLVE',
      },
      patch: `${'+x\n'.repeat(10_000)}`,
      changedFiles: ['a'],
    });
    const body = renderPullRequestComment(report, { runUrl: null });
    expect(body).toContain('**prepare_dependencies** failed');
    expect(body).toContain('npm ERR! ERESOLVE');
    expect(body).toContain('truncated here; complete in the artifact');
    expect(body.length).toBeLessThan(60_500);
  });

  it('creates a comment once and updates it afterwards', async () => {
    const created = fakeIssues([]);
    await expect(
      upsertPullRequestComment(
        created.issues,
        { owner: 'acme', repo: 'app', issueNumber: 7 },
        `${commentMarker}\nhello`,
        commentMarker,
      ),
    ).resolves.toEqual({ action: 'created', id: 900 });
    expect(created.calls.map((call) => call.method)).toEqual(['listComments', 'createComment']);
    expect(created.calls[1].params).toEqual({
      owner: 'acme',
      repo: 'app',
      issue_number: 7,
      body: `${commentMarker}\nhello`,
    });

    const updated = fakeIssues([{ id: 55, body: `${commentMarker}\nold` }]);
    await expect(
      upsertPullRequestComment(updated.issues, { owner: 'acme', repo: 'app', issueNumber: 7 }, 'new', commentMarker),
    ).resolves.toEqual({ action: 'updated', id: 55 });
    expect(updated.calls[1]).toEqual({
      method: 'updateComment',
      params: { owner: 'acme', repo: 'app', comment_id: 55, body: 'new' },
    });
  });
});

describe('action run on a shallow pull request checkout', () => {
  it('detects the bump, investigates from the base commit, and publishes summary, outputs, files, and a comment', async () => {
    const fixture = await pullRequestWorkspace();
    const { deps, upgrade, sinks } = dependencies();

    const outcome = await runAction({ inputs: defaultInputs, context: fixture.context, env: {} }, deps);
    expect(outcome.status).toBe('completed');
    expect(upgrade).toHaveBeenCalledTimes(1);
    const options = upgrade.mock.calls[0][0] as unknown as {
      repoPath: string;
      packageName: string;
      targetVersion: string;
      attemptRepair: boolean;
      keepWorkspace: boolean;
      proposalGenerator: unknown;
    };
    expect(options).toMatchObject({
      packageName: 'zod',
      targetVersion: '4.1.5',
      attemptRepair: true,
      keepWorkspace: false,
    });
    expect(typeof options.proposalGenerator).toBe('function');
    expect(options.repoPath).not.toBe(fixture.workspace);

    const report = sampleIsolatedUpgradeReport();
    const reportDirectory = path.join(fixture.workspace, 'depsherpa-report');
    expect(JSON.parse(await readFile(path.join(reportDirectory, 'report.json'), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(report)),
    );
    expect(await readFile(path.join(reportDirectory, 'report.md'), 'utf8')).toBe(renderIsolatedUpgradeReport(report));
    expect(await readFile(path.join(reportDirectory, 'candidate.patch'), 'utf8')).toBe(`${report.patch}\n`);
    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.reportFiles.files.map((file) => path.basename(file))).toEqual([
      'report.json',
      'report.md',
      'candidate.patch',
    ]);
    expect(sinks.summary.join('')).toContain('# DepSherpa isolated upgrade: zod');
    expect(sinks.outputs).toEqual({
      verdict: 'repaired_ready_for_review',
      'repair-status': 'verified',
      'report-dir': 'depsherpa-report',
      package: 'zod',
      'target-version': '4.1.5',
    });
    expect(outcome.comment).toBe('created');
    expect(sinks.comments).toHaveLength(1);
    expect(sinks.comments[0]).toContain(commentMarker);
    expect(sinks.comments[0]).toContain('https://github.com/acme/sample/actions/runs/123');

    // The workspace itself was left as the runner produced it: still on the PR head, no stray branch, no edits.
    expect(git(['rev-parse', 'HEAD'], fixture.workspace)).toBe(fixture.headSha);
    expect(git(['branch', '--list', 'depsherpa/*'], fixture.workspace)).toBe('');
    expect(git(['status', '--porcelain', '--', 'package.json', 'package-lock.json'], fixture.workspace)).toBe('');
  });

  it('checks out the base commit in a separate clone even when the shallow workspace lacks it', async () => {
    const fixture = await pullRequestWorkspace();
    const temporaryRoot = await temporaryDirectory('depsherpa-source-test-');
    const source = await prepareSourceCheckout({ workspace: fixture.workspace, temporaryRoot, sha: fixture.baseSha });
    expect(source.sha).toBe(fixture.baseSha);
    expect(git(['rev-parse', 'HEAD'], source.path)).toBe(fixture.baseSha);
    expect(JSON.parse(await readFile(path.join(source.path, 'package.json'), 'utf8'))).toMatchObject({
      dependencies: { zod: '3.23.8' },
    });
    expect(git(['status', '--porcelain'], source.path)).toBe('');
    await expect(prepareSourceCheckout({ workspace: fixture.workspace, temporaryRoot, sha: 'main' })).rejects.toThrow(
      'non-SHA',
    );
  });

  it('skips with an explanation when the pull request is not a single dependency bump', async () => {
    const fixture = await pullRequestWorkspace();
    await writeFile(
      path.join(fixture.workspace, 'package.json'),
      JSON.stringify({
        name: 'sample',
        dependencies: { zod: '^4.1.5', semver: '^7.0.0' },
        scripts: { test: 'node -e 0' },
      }),
    );
    const { deps, upgrade, sinks } = dependencies();
    const outcome = await runAction({ inputs: defaultInputs, context: fixture.context, env: {} }, deps);
    expect(outcome.status).toBe('skipped');
    expect(upgrade).not.toHaveBeenCalled();
    expect(sinks.summary.join('')).toContain('No isolated upgrade was run');
    expect(sinks.outputs).toMatchObject({ verdict: 'skipped', 'repair-status': 'not_run', 'report-dir': '' });
    expect(sinks.comments).toHaveLength(0);
  });

  it('uses explicit inputs against the workspace HEAD outside pull requests and validates them', async () => {
    const fixture = await pullRequestWorkspace();
    const context: GitHubContext = { ...fixture.context, eventName: 'workflow_dispatch', pullRequest: null };
    const inputs: ActionInputs = {
      ...defaultInputs,
      packageName: 'zod',
      targetVersion: '4.1.5',
      attemptRepair: false,
      comment: false,
    };
    const { deps, upgrade } = dependencies();
    const outcome = await runAction({ inputs, context, env: {} }, deps);
    expect(outcome.status).toBe('completed');
    expect(upgrade.mock.calls[0][0]).toMatchObject({
      repoPath: fixture.workspace,
      packageName: 'zod',
      targetVersion: '4.1.5',
      attemptRepair: false,
    });
    expect(outcome.status === 'completed' && outcome.comment).toBe('skipped');

    await expect(
      runAction({ inputs: { ...inputs, targetVersion: '^4' }, context, env: {} }, dependencies().deps),
    ).rejects.toThrow('exact semantic version');
    await expect(
      runAction({ inputs: { ...inputs, packageName: 'Zod;rm' }, context, env: {} }, dependencies().deps),
    ).rejects.toThrow('npm package name');
    await expect(
      runAction({ inputs: { ...inputs, targetVersion: null }, context, env: {} }, dependencies().deps),
    ).rejects.toThrow('both');
    const nothing = await runAction({ inputs: defaultInputs, context, env: {} }, dependencies().deps);
    expect(nothing.status).toBe('skipped');
  });

  it('keeps the run successful when the comment cannot be posted', async () => {
    const fixture = await pullRequestWorkspace();
    const { deps, sinks } = dependencies({
      publishComment: async () => {
        throw new Error('GitHub API POST failed with 403: Resource not accessible by integration');
      },
    });
    const outcome = await runAction({ inputs: defaultInputs, context: fixture.context, env: {} }, deps);
    expect(outcome.status === 'completed' && outcome.comment).toBe('failed');
    expect(sinks.warnings[0]).toContain('403');
  });

  it('reports the run without a comment when no token or pull request is available', async () => {
    const fixture = await pullRequestWorkspace();
    const { deps } = dependencies({ publishComment: null });
    const outcome = await runAction({ inputs: defaultInputs, context: fixture.context, env: {} }, deps);
    expect(outcome.status === 'completed' && outcome.comment).toBe('skipped');
  });
});
