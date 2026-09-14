import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIsolatedUpgradeReport, renderMarkdownReport } from '../core/report';
import type { InvestigationReport } from '../core/types';
import { createLocalApiHandler, type LocalApiDependencies } from './api';
import type { LocalUpgradeEvent } from './contracts';
import { sampleIsolatedUpgradeReport } from './report-fixture';
import { validateRepositoryPath } from './repository';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix = 'depsherpa-api-test-'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function gitRoot(): Promise<string> {
  const root = await temporaryDirectory();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { zod: '3.23.8' } }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

function dependencies(overrides: Partial<LocalApiDependencies> = {}): LocalApiDependencies {
  return {
    gate: () => ({ enabled: true }),
    upgrade: vi.fn(async () => sampleIsolatedUpgradeReport()),
    inspect: vi.fn(async (): Promise<InvestigationReport> => {
      const report = sampleIsolatedUpgradeReport();
      return { generatedAt: report.generatedAt, repository: 'sample', manifestPath: '/repo/package.json', packageManager: 'npm', finding: report.finding, checks: report.checks, results: [], externalWritesAllowed: false };
    }),
    validateRepository: async (repoPath) => ({ ok: true, path: repoPath }),
    keepWorkspaceAllowed: false,
    projectRoot: '/Users/sample/dep-sherpa',
    modelProvider: 'none',
    heartbeatMs: 20,
    ...overrides,
  };
}

const origin = 'http://localhost:3000';

function post(route: 'upgrade' | 'inspect', body: unknown, init: { headers?: Record<string, string>; raw?: string } = {}): Request {
  return new Request(`${origin}/api/local/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin', ...init.headers },
    body: init.raw ?? JSON.stringify(body),
  });
}

const loopback = { remoteAddress: '127.0.0.1' };
const validBody = { repoPath: '/Users/sample/projects/checkout', packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true };

async function events(response: Response): Promise<LocalUpgradeEvent[]> {
  const text = await response.text();
  return text.trim().split('\n').map((line) => JSON.parse(line) as LocalUpgradeEvent);
}

describe('local API environment boundary', () => {
  it('rejects production and hosted environments before touching the core', async () => {
    for (const reason of ['hosted_deployment', 'production_environment', 'harness_disabled'] as const) {
      const deps = dependencies({ gate: () => ({ enabled: false, reason }) });
      const handler = createLocalApiHandler(deps);
      const response = await handler(post('upgrade', validBody), loopback);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', reason, message: expect.any(String) },
      });
      expect(deps.upgrade).not.toHaveBeenCalled();
      expect(deps.inspect).not.toHaveBeenCalled();

      const capabilities = await handler(new Request(`${origin}/api/local/capabilities`), loopback);
      expect(capabilities.status).toBe(200);
      await expect(capabilities.json()).resolves.toEqual({ enabled: false, reason });
    }
  });

  it('rejects cross-origin and non-loopback requests even when the environment allows execution', async () => {
    const deps = dependencies();
    const handler = createLocalApiHandler(deps);
    const crossOrigin = await handler(post('upgrade', validBody, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }), loopback);
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({ error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', reason: 'cross_origin_request' } });
    const remote = await handler(post('upgrade', validBody), { remoteAddress: '192.168.0.9' });
    expect(remote.status).toBe(403);
    await expect(remote.json()).resolves.toMatchObject({ error: { reason: 'non_loopback_request' } });
    expect(deps.upgrade).not.toHaveBeenCalled();
  });

  it('describes its capabilities without offering any command, script, or path controls', async () => {
    const handler = createLocalApiHandler(dependencies({ keepWorkspaceAllowed: true }));
    const response = await handler(new Request(`${origin}/api/local/capabilities`, { headers: { origin } }), loopback);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      enabled: true,
      mode: 'local-harness',
      keepWorkspaceAllowed: true,
      projectRoot: '/Users/sample/dep-sherpa',
      proposalGenerator: 'none',
      executionModel: { disposableClone: true, installScriptsAllowed: false, externalWritesAllowed: false, operatingSystemSandbox: false },
    });
    expect(body.policy).toMatchObject({ maxFiles: 3, maxChangedLines: 12 });
    expect(Object.keys(body).sort()).toEqual(['enabled', 'executionModel', 'keepWorkspaceAllowed', 'mode', 'policy', 'projectRoot', 'proposalGenerator']);
  });

  it('answers unknown routes and wrong methods without executing anything', async () => {
    const deps = dependencies();
    const handler = createLocalApiHandler(deps);
    expect((await handler(new Request(`${origin}/api/local/exec`, { method: 'POST' }), loopback)).status).toBe(404);
    expect((await handler(new Request(`${origin}/api/local/upgrade`), loopback)).status).toBe(405);
    expect((await handler(new Request(`${origin}/api/local/capabilities`, { method: 'POST' }), loopback)).status).toBe(405);
    expect(deps.upgrade).not.toHaveBeenCalled();
  });
});

describe('local API input validation', () => {
  it('rejects malformed requests with INVALID_INPUT and never calls the core', async () => {
    const deps = dependencies();
    const handler = createLocalApiHandler(deps);
    const cases: Array<[unknown, string]> = [
      [{ ...validBody, repoPath: 'relative/checkout' }, 'absolute path'],
      [{ ...validBody, packageName: 'Zod;rm -rf /' }, 'npm package name'],
      [{ ...validBody, targetVersion: '^4.0.0' }, 'exact semantic version'],
      [{ ...validBody, attemptRepair: 'yes' }, 'boolean'],
      [{ ...validBody, command: 'npm run evil' }, 'Unsupported field'],
      [{ ...validBody, env: { PATH: '/tmp' } }, 'Unsupported field'],
      [[], 'JSON object'],
    ];
    for (const [body, fragment] of cases) {
      const response = await handler(post('upgrade', body), loopback);
      expect(response.status).toBe(400);
      const payload = await response.json() as { error: { code: string; message: string } };
      expect(payload.error.code).toBe('INVALID_INPUT');
      expect(payload.error.message).toContain(fragment);
    }
    const notJson = await handler(post('upgrade', null, { raw: '{"repoPath": ' }), loopback);
    expect(notJson.status).toBe(400);
    const wrongType = await handler(post('upgrade', validBody, { headers: { 'content-type': 'text/plain' } }), loopback);
    expect(wrongType.status).toBe(415);
    const tooLarge = await handler(post('upgrade', { ...validBody, packageName: 'a'.repeat(70_000) }), loopback);
    expect(tooLarge.status).toBe(413);
    expect(deps.upgrade).not.toHaveBeenCalled();
  });

  it('rejects retention unless the harness was started with the retention option', async () => {
    const denied = createLocalApiHandler(dependencies({ keepWorkspaceAllowed: false }));
    const response = await denied(post('upgrade', { ...validBody, keepWorkspace: true }), loopback);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'KEEP_WORKSPACE_NOT_ENABLED' } });
  });

  it('rejects paths that do not exist, are files, or are not a Git root', async () => {
    const deps = dependencies({ validateRepository: validateRepositoryPath });
    const handler = createLocalApiHandler(deps);
    const missing = await handler(post('upgrade', { ...validBody, repoPath: path.join(tmpdir(), 'depsherpa-does-not-exist-9f2c') }), loopback);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: 'REPOSITORY_NOT_FOUND' } });

    const plainDirectory = await temporaryDirectory();
    const notGit = await handler(post('upgrade', { ...validBody, repoPath: plainDirectory }), loopback);
    expect(notGit.status).toBe(400);
    await expect(notGit.json()).resolves.toMatchObject({ error: { code: 'NOT_A_GIT_ROOT' } });

    const root = await gitRoot();
    const nested = path.join(root, 'packages', 'web');
    await mkdir(nested, { recursive: true });
    const subdirectory = await handler(post('upgrade', { ...validBody, repoPath: nested }), loopback);
    expect(subdirectory.status).toBe(400);
    const payload = await subdirectory.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('NOT_A_GIT_ROOT');
    expect(payload.error.message).toContain('Supply the Git root');

    const file = await handler(post('upgrade', { ...validBody, repoPath: path.join(root, 'package.json') }), loopback);
    await expect(file.json()).resolves.toMatchObject({ error: { code: 'REPOSITORY_NOT_FOUND' } });
    expect(deps.upgrade).not.toHaveBeenCalled();
  });
});

describe('local API core invocation', () => {
  it('calls the isolated upgrade core with exactly the validated options and streams the report verbatim', async () => {
    const report = sampleIsolatedUpgradeReport();
    const upgrade = vi.fn(async () => report);
    const root = await gitRoot();
    const handler = createLocalApiHandler(dependencies({ upgrade, validateRepository: validateRepositoryPath }));
    const response = await handler(post('upgrade', { ...validBody, repoPath: root, attemptRepair: true }), loopback);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const streamed = await events(response);
    expect(streamed[0]).toMatchObject({ type: 'accepted' });
    const final = streamed.at(-1);
    expect(final?.type).toBe('report');
    if (final?.type !== 'report') throw new Error('expected a report event');
    expect(final.report).toEqual(JSON.parse(JSON.stringify(report)));
    expect(final.markdown).toBe(renderIsolatedUpgradeReport(report));

    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(upgrade).toHaveBeenCalledWith({
      repoPath: await realpath(root),
      packageName: 'zod',
      targetVersion: '4.1.5',
      attemptRepair: true,
      keepWorkspace: false,
    });
  });

  it('passes attemptRepair=false through unchanged and never injects extra options', async () => {
    const upgrade = vi.fn<LocalApiDependencies['upgrade']>(async () => sampleIsolatedUpgradeReport());
    const handler = createLocalApiHandler(dependencies({ upgrade, timeoutMs: 45_000 }));
    await events(await handler(post('upgrade', { ...validBody, attemptRepair: false }), loopback));
    expect(upgrade.mock.calls[0][0]).toEqual({
      repoPath: validBody.repoPath,
      packageName: 'zod',
      targetVersion: '4.1.5',
      attemptRepair: false,
      keepWorkspace: false,
      timeoutMs: 45_000,
    });
  });

  it('forwards workspace retention only when explicitly enabled on the harness', async () => {
    const upgrade = vi.fn<LocalApiDependencies['upgrade']>(async () => sampleIsolatedUpgradeReport({ workspace: { disposable: true, retained: true, path: '/tmp/depsherpa-x/workspace' } }));
    const handler = createLocalApiHandler(dependencies({ upgrade, keepWorkspaceAllowed: true }));
    const streamed = await events(await handler(post('upgrade', { ...validBody, keepWorkspace: true }), loopback));
    expect(upgrade.mock.calls[0][0]).toMatchObject({ keepWorkspace: true });
    const final = streamed.at(-1);
    expect(final?.type === 'report' && final.report.workspace.retained).toBe(true);
  });

  it('emits heartbeats while the core runs and releases the run lock afterwards', async () => {
    let finish: (() => void) | null = null;
    const upgrade = vi.fn(() => new Promise<ReturnType<typeof sampleIsolatedUpgradeReport>>((resolve) => {
      finish = () => resolve(sampleIsolatedUpgradeReport());
    }));
    const handler = createLocalApiHandler(dependencies({ upgrade, heartbeatMs: 5 }));
    const first = await handler(post('upgrade', validBody), loopback);
    const second = await handler(post('upgrade', validBody), loopback);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: { code: 'RUN_IN_PROGRESS' } });

    await new Promise((resolve) => setTimeout(resolve, 30));
    finish!();
    const streamed = await events(first);
    expect(streamed.some((event) => event.type === 'heartbeat')).toBe(true);
    expect(streamed.at(-1)?.type).toBe('report');

    const third = await handler(post('upgrade', validBody), loopback);
    expect(third.status).toBe(200);
    expect(upgrade).toHaveBeenCalledTimes(2);
  });

  it('reports core failures as a streamed error instead of a fabricated report', async () => {
    const upgrade = vi.fn(async () => { throw new Error('The isolated npm runner requires a committed package-lock.json.'); });
    const handler = createLocalApiHandler(dependencies({ upgrade }));
    const streamed = await events(await handler(post('upgrade', validBody), loopback));
    expect(streamed.at(-1)).toEqual({
      type: 'error',
      error: { code: 'RUN_FAILED', message: 'The isolated npm runner requires a committed package-lock.json.' },
    });
    expect(streamed.some((event) => event.type === 'report')).toBe(false);
    const next = await handler(post('upgrade', validBody), loopback);
    expect(next.status).toBe(200);
  });

  it('runs read-only inspection through the CLI core without executing project checks', async () => {
    const deps = dependencies();
    const handler = createLocalApiHandler(deps);
    const response = await handler(post('inspect', { repoPath: validBody.repoPath, packageName: 'zod', targetVersion: '4.1.5' }), loopback);
    expect(response.status).toBe(200);
    const payload = await response.json() as { report: InvestigationReport; markdown: string };
    expect(deps.inspect).toHaveBeenCalledWith({ repoPath: validBody.repoPath, packageName: 'zod', targetVersion: '4.1.5', runProjectChecks: false, timeoutMs: undefined });
    expect(payload.markdown).toBe(renderMarkdownReport(payload.report));
    expect(payload.report.externalWritesAllowed).toBe(false);
  });

  it('surfaces inspection failures from the core as RUN_FAILED', async () => {
    const inspect = vi.fn(async () => { throw new Error('zod is not declared in package.json'); });
    const handler = createLocalApiHandler(dependencies({ inspect }));
    const response = await handler(post('inspect', { repoPath: validBody.repoPath, packageName: 'zod', targetVersion: '4.1.5' }), loopback);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: { code: 'RUN_FAILED', message: 'zod is not declared in package.json' } });
  });
});
