import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIsolatedUpgradeReport } from '../core/report';
import { sampleIsolatedUpgradeReport, sampleRepairAttempt } from './report-fixture';
import { commentMarker, formatOutputAssignments, renderPullRequestComment } from './comment';
import { pullRequestFromPayload, readGitHubContext } from './context';
import { detectDependencyChange, exactVersionFromRange } from './detect';
import { upsertPullRequestComment } from './github';
import { parseBooleanInput, readActionInputs, validatePackageName, validateTargetVersion } from './inputs';
import { runAction, type ActionRunDependencies } from './run';
import { prepareSourceCheckout } from './source';

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
  return execFileSync('git', ['-c', 'user.name=DepSherpa', '-c', 'user.email=test@depsherpa.invalid', ...args], { cwd, encoding: 'utf8' }).trim();
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
  await writeFile(path.join(seed, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { zod: '3.23.8' }, scripts: { test: 'node -e 0' } }, null, 2));
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  git(['add', '.'], seed);
  git(['commit', '--quiet', '-m', 'baseline'], seed);
  const baseSha = git(['rev-parse', 'HEAD'], seed);
  git(['checkout', '--quiet', '-b', 'dependabot/npm_and_yarn/zod-4.1.5'], seed);
  await writeFile(path.join(seed, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { zod: '^4.1.5' }, scripts: { test: 'node -e 0' } }, null, 2));
  git(['commit', '--quiet', '-am', 'chore(deps): bump zod'], seed);
  const headSha = git(['rev-parse', 'HEAD'], seed);
  git(['remote', 'add', 'origin', origin], seed);
  git(['push', '--quiet', 'origin', 'main', 'dependabot/npm_and_yarn/zod-4.1.5'], seed);

  const workspace = path.join(root, 'workspace');
  // A file:// URL forces a genuinely shallow clone; plain paths ignore --depth.
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'dependabot/npm_and_yarn/zod-4.1.5', `file://${origin}`, workspace]);
  expect(git(['rev-parse', '--is-shallow-repository'], workspace)).toBe('true');

  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: { number: 7, base: { sha: baseSha, ref: 'main' }, head: { sha: headSha, ref: 'dependabot/npm_and_yarn/zod-4.1.5' } } }));
  const summaryPath = path.join(root, 'summary.md');
  const outputPath = path.join(root, 'output.txt');
  await writeFile(summaryPath, '');
  await writeFile(outputPath, '');
  return { root, workspace, baseSha, headSha, eventPath, summaryPath, outputPath };
}

function githubFetch(existingComments: Array<{ id: number; body: string }> = []) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') return Response.json(existingComments);
    if (method === 'PATCH') return Response.json({ id: Number(url.split('/').at(-1)) });
    return Response.json({ id: 900 }, { status: 201 });
  });
  return { impl: impl as unknown as typeof fetch, requests };
}

function dependencies(overrides: Partial<ActionRunDependencies> = {}): ActionRunDependencies & { upgrade: ReturnType<typeof vi.fn> } {
  const upgrade = vi.fn(async () => sampleIsolatedUpgradeReport());
  return {
    upgrade,
    prepareSource: prepareSourceCheckout,
    fetchImpl: githubFetch().impl,
    log: () => {},
    warn: () => {},
    ...overrides,
  } as ActionRunDependencies & { upgrade: ReturnType<typeof vi.fn> };
}

describe('action inputs and context', () => {
  it('parses booleans strictly and rejects escaping output directories', () => {
    expect(parseBooleanInput('true', false)).toBe(true);
    expect(parseBooleanInput('FALSE', true)).toBe(false);
    expect(parseBooleanInput('', false)).toBe(false);
    expect(() => parseBooleanInput('maybe', true)).toThrow('boolean');
    expect(readActionInputs({ DEPSHERPA_PACKAGE: ' zod ', DEPSHERPA_TARGET_VERSION: '4.1.5' })).toEqual({ packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true, comment: true, outputDir: 'depsherpa-report' });
    expect(() => readActionInputs({ DEPSHERPA_OUTPUT_DIR: '../outside' })).toThrow('relative path');
    expect(() => readActionInputs({ DEPSHERPA_OUTPUT_DIR: '/etc' })).toThrow('relative path');
  });

  it('accepts only valid npm names and exact versions', () => {
    expect(validatePackageName('@tanstack/react-query')).toEqual({ ok: true, value: '@tanstack/react-query' });
    for (const name of ['Zod', '../zod', 'zod; rm -rf /', 'zod@4', '', '$(whoami)']) expect(validatePackageName(name).ok).toBe(false);
    expect(validateTargetVersion('v4.1.5')).toEqual({ ok: true, value: '4.1.5' });
    for (const version of ['^4.1.5', '~4.1.0', 'latest', '4', '4.1.x', '>=4.0.0', '']) expect(validateTargetVersion(version).ok).toBe(false);
  });

  it('reads the pull request context only from a well-formed event payload', async () => {
    const sha = 'a'.repeat(40);
    expect(pullRequestFromPayload({ pull_request: { number: 3, base: { sha, ref: 'main' }, head: { sha: 'b'.repeat(40), ref: 'bump' } } })).toEqual({ number: 3, baseSha: sha, headSha: 'b'.repeat(40), baseRef: 'main', headRef: 'bump' });
    expect(pullRequestFromPayload({ pull_request: { number: 3, base: { sha: 'main' }, head: { sha } } })).toBeNull();
    expect(pullRequestFromPayload({ issue: { number: 3 } })).toBeNull();
    const context = await readGitHubContext(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '/event.json', GITHUB_REPOSITORY: 'acme/app', GITHUB_RUN_ID: '42', GITHUB_WORKSPACE: '/work' },
      async () => JSON.stringify({ pull_request: { number: 9, base: { sha }, head: { sha } } }),
    );
    expect(context).toMatchObject({ eventName: 'pull_request', repository: 'acme/app', runUrl: 'https://github.com/acme/app/actions/runs/42', workspace: '/work', pullRequest: { number: 9 } });
    const push = await readGitHubContext({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: '/event.json' }, async () => '{}');
    expect(push.pullRequest).toBeNull();
  });
});

describe('dependency change detection', () => {
  it('finds the single upgraded dependency and its exact target', () => {
    const detection = detectDependencyChange(
      { dependencies: { zod: '^3.23.8', react: '19.0.0' } },
      { dependencies: { zod: '^4.1.5', react: '19.0.0' } },
    );
    expect(detection).toEqual({ ok: true, change: { packageName: 'zod', section: 'dependencies', fromRange: '^3.23.8', toRange: '^4.1.5', targetVersion: '4.1.5' } });
    expect(exactVersionFromRange('4.1.5')).toBe('4.1.5');
    expect(exactVersionFromRange('~5.0.1')).toBe('5.0.1');
    expect(exactVersionFromRange('workspace:*')).toBeNull();
  });

  it('refuses grouped, added, removed, or unresolvable changes', () => {
    expect(detectDependencyChange({ dependencies: { zod: '^3.0.0' } }, { dependencies: { zod: '^3.0.0' } })).toMatchObject({ ok: false, reason: expect.stringContaining('does not change') });
    expect(detectDependencyChange({ dependencies: { a: '1.0.0', b: '1.0.0' } }, { dependencies: { a: '2.0.0', b: '2.0.0' } })).toMatchObject({ ok: false, changes: ['dependencies.a: 1.0.0 → 2.0.0', 'dependencies.b: 1.0.0 → 2.0.0'] });
    expect(detectDependencyChange({ dependencies: {} }, { dependencies: { a: '2.0.0' } })).toMatchObject({ ok: false });
    expect(detectDependencyChange({ devDependencies: { a: '1.0.0' } }, { devDependencies: { a: 'latest' } })).toMatchObject({ ok: false, reason: expect.stringContaining('exact version') });
  });
});

describe('pull request comment', () => {
  it('summarizes the report, marks model output as a suggestion, and never offers to apply anything', () => {
    const report = sampleIsolatedUpgradeReport({ repair: sampleRepairAttempt({ proposal: { kind: 'agent', id: 'agent-1', summary: 's', evidence: [], edits: [] }, proposalSource: 'agent', recipeId: null }) });
    const body = renderPullRequestComment(report, { runUrl: 'https://github.com/acme/app/actions/runs/1' });
    expect(body.startsWith(commentMarker)).toBe(true);
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
      preparation: { name: 'prepare_dependencies', command: 'npm ci', status: 'failed', exitCode: 1, durationMs: 1, output: 'npm ERR! ERESOLVE' },
      patch: `${'+x\n'.repeat(10_000)}`,
      changedFiles: ['a'],
    });
    const body = renderPullRequestComment(report, { runUrl: null });
    expect(body).toContain('**prepare_dependencies** failed');
    expect(body).toContain('npm ERR! ERESOLVE');
    expect(body).toContain('truncated here; complete in the artifact');
    expect(body.length).toBeLessThan(60_500);
  });

  it('writes multi-line outputs in GITHUB_OUTPUT heredoc form', () => {
    expect(formatOutputAssignments({ verdict: 'blocked', note: 'a\nb' })).toBe('verdict<<DEPSHERPA_EOF\nblocked\nDEPSHERPA_EOF\nnote<<DEPSHERPA_EOF\na\nb\nDEPSHERPA_EOF\n');
    expect(() => formatOutputAssignments({ 'bad name': 'x' })).toThrow('Invalid output name');
  });

  it('creates a comment once and updates it afterwards', async () => {
    const created = githubFetch([]);
    await expect(upsertPullRequestComment({ apiUrl: 'https://api.github.com', repository: 'acme/app', pullNumber: 7, token: 't' }, `${commentMarker}\nhello`, commentMarker, created.impl)).resolves.toEqual({ action: 'created', id: 900 });
    expect(created.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://api.github.com/repos/acme/app/issues/7/comments?per_page=100&page=1',
      'POST https://api.github.com/repos/acme/app/issues/7/comments',
    ]);
    const updated = githubFetch([{ id: 55, body: `${commentMarker}\nold` }]);
    await expect(upsertPullRequestComment({ apiUrl: 'https://api.github.com', repository: 'acme/app', pullNumber: 7, token: 't' }, 'new', commentMarker, updated.impl)).resolves.toEqual({ action: 'updated', id: 55 });
    expect(updated.requests[1]).toMatchObject({ method: 'PATCH', url: 'https://api.github.com/repos/acme/app/issues/comments/55', body: { body: 'new' } });
  });
});

describe('action run on a shallow pull request checkout', () => {
  it('detects the bump, investigates from the base commit, publishes summary, outputs, files, and a comment', async () => {
    const fixture = await pullRequestWorkspace();
    const github = githubFetch();
    const deps = dependencies({ fetchImpl: github.impl });
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: fixture.eventPath,
      GITHUB_WORKSPACE: fixture.workspace,
      GITHUB_REPOSITORY: 'acme/sample',
      GITHUB_RUN_ID: '123',
      GITHUB_STEP_SUMMARY: fixture.summaryPath,
      GITHUB_OUTPUT: fixture.outputPath,
      GITHUB_TOKEN: 'ghs_test',
    };

    const outcome = await runAction(env, deps);
    expect(outcome.status).toBe('completed');
    expect(deps.upgrade).toHaveBeenCalledTimes(1);
    const options = deps.upgrade.mock.calls[0][0] as { repoPath: string; packageName: string; targetVersion: string; attemptRepair: boolean; keepWorkspace: boolean; proposalGenerator: unknown };
    expect(options).toMatchObject({ packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true, keepWorkspace: false });
    expect(typeof options.proposalGenerator).toBe('function');
    expect(options.repoPath).not.toBe(fixture.workspace);

    const report = sampleIsolatedUpgradeReport();
    const reportDir = path.join(fixture.workspace, 'depsherpa-report');
    expect(JSON.parse(await readFile(path.join(reportDir, 'report.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(report)));
    expect(await readFile(path.join(reportDir, 'report.md'), 'utf8')).toBe(renderIsolatedUpgradeReport(report));
    expect(await readFile(path.join(reportDir, 'candidate.patch'), 'utf8')).toBe(`${report.patch}\n`);
    expect(await readFile(fixture.summaryPath, 'utf8')).toContain('# DepSherpa isolated upgrade: zod');
    const outputs = await readFile(fixture.outputPath, 'utf8');
    expect(outputs).toContain('verdict<<DEPSHERPA_EOF\nrepaired_ready_for_review\n');
    expect(outputs).toContain('report-dir<<DEPSHERPA_EOF\ndepsherpa-report\n');
    expect(outputs).toContain('target-version<<DEPSHERPA_EOF\n4.1.5\n');

    expect(outcome.status === 'completed' && outcome.comment).toBe('created');
    const post = github.requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('https://api.github.com/repos/acme/sample/issues/7/comments');
    expect((post?.body as { body: string }).body).toContain(commentMarker);

    // The workspace itself was left as the runner produced it: still shallow, still on the PR head, no stray branch.
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
    expect(JSON.parse(await readFile(path.join(source.path, 'package.json'), 'utf8'))).toMatchObject({ dependencies: { zod: '3.23.8' } });
    expect(git(['status', '--porcelain'], source.path)).toBe('');
    await expect(prepareSourceCheckout({ workspace: fixture.workspace, temporaryRoot, sha: 'main' })).rejects.toThrow('non-SHA');
  });

  it('skips with an explanation when the pull request is not a single dependency bump', async () => {
    const fixture = await pullRequestWorkspace();
    await writeFile(path.join(fixture.workspace, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { zod: '^4.1.5', semver: '^7.0.0' }, scripts: { test: 'node -e 0' } }));
    const deps = dependencies();
    const outcome = await runAction({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: fixture.eventPath, GITHUB_WORKSPACE: fixture.workspace, GITHUB_STEP_SUMMARY: fixture.summaryPath, GITHUB_OUTPUT: fixture.outputPath }, deps);
    expect(outcome.status).toBe('skipped');
    expect(deps.upgrade).not.toHaveBeenCalled();
    expect(await readFile(fixture.summaryPath, 'utf8')).toContain('No isolated upgrade was run');
    expect(await readFile(fixture.outputPath, 'utf8')).toContain('verdict<<DEPSHERPA_EOF\nskipped\n');
  });

  it('uses explicit inputs against the workspace HEAD outside pull requests and validates them', async () => {
    const fixture = await pullRequestWorkspace();
    const deps = dependencies();
    const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKSPACE: fixture.workspace, GITHUB_STEP_SUMMARY: fixture.summaryPath, GITHUB_OUTPUT: fixture.outputPath, DEPSHERPA_PACKAGE: 'zod', DEPSHERPA_TARGET_VERSION: '4.1.5', DEPSHERPA_ATTEMPT_REPAIR: 'false', DEPSHERPA_COMMENT: 'false' };
    const outcome = await runAction(env, deps);
    expect(outcome.status).toBe('completed');
    expect(deps.upgrade.mock.calls[0][0]).toMatchObject({ repoPath: fixture.workspace, packageName: 'zod', targetVersion: '4.1.5', attemptRepair: false });
    expect(outcome.status === 'completed' && outcome.comment).toBe('skipped');

    await expect(runAction({ ...env, DEPSHERPA_TARGET_VERSION: '^4' }, dependencies())).rejects.toThrow('exact semantic version');
    await expect(runAction({ ...env, DEPSHERPA_PACKAGE: 'Zod;rm' }, dependencies())).rejects.toThrow('npm package name');
    await expect(runAction({ ...env, DEPSHERPA_TARGET_VERSION: '' }, dependencies())).rejects.toThrow('both');
    const nothing = await runAction({ GITHUB_EVENT_NAME: 'push', GITHUB_WORKSPACE: fixture.workspace }, dependencies());
    expect(nothing.status).toBe('skipped');
  });

  it('keeps the run successful when the comment cannot be posted', async () => {
    const fixture = await pullRequestWorkspace();
    const failing = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await runAction(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: fixture.eventPath, GITHUB_WORKSPACE: fixture.workspace, GITHUB_REPOSITORY: 'acme/sample', GITHUB_TOKEN: 'ghs_readonly' },
      dependencies({ fetchImpl: failing, warn }),
    );
    expect(outcome.status === 'completed' && outcome.comment).toBe('failed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('403'));
  });
});
