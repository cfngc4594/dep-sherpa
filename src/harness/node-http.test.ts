import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalApiHandler, type LocalApiDependencies } from './api';
import { createLocalHarnessMiddleware, isLocalApiPath } from './node-http';
import { sampleIsolatedUpgradeReport } from './report-fixture';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function dependencies(overrides: Partial<LocalApiDependencies> = {}): LocalApiDependencies {
  return {
    gate: () => ({ enabled: true }),
    upgrade: vi.fn(async () => sampleIsolatedUpgradeReport()),
    inspect: vi.fn(),
    validateRepository: async (repoPath) => ({ ok: true, path: repoPath }),
    keepWorkspaceAllowed: false,
    projectRoot: null,
    heartbeatMs: 10,
    ...overrides,
  };
}

async function listen(deps: LocalApiDependencies): Promise<string> {
  const middleware = createLocalHarnessMiddleware(createLocalApiHandler(deps));
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 200;
      response.end('application');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('local harness Node middleware', () => {
  it('only claims /api/local paths', () => {
    expect(isLocalApiPath('/api/local/upgrade')).toBe(true);
    expect(isLocalApiPath('/api/local/capabilities?x=1')).toBe(true);
    expect(isLocalApiPath('/api/local')).toBe(true);
    expect(isLocalApiPath('/api/localhost')).toBe(false);
    expect(isLocalApiPath('/api/investigate')).toBe(false);
    expect(isLocalApiPath(undefined)).toBe(false);
  });

  it('passes unrelated requests to the application untouched', async () => {
    const base = await listen(dependencies());
    const response = await fetch(`${base}/api/investigate`, { method: 'POST' });
    expect(await response.text()).toBe('application');
  });

  it('serves capabilities and streams a real upgrade over loopback HTTP', async () => {
    const deps = dependencies();
    const base = await listen(deps);
    const capabilities = await fetch(`${base}/api/local/capabilities`);
    expect(capabilities.status).toBe(200);
    await expect(capabilities.json()).resolves.toMatchObject({ enabled: true, mode: 'local-harness' });

    const response = await fetch(`${base}/api/local/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ repoPath: '/Users/sample/checkout', packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(lines[0].type).toBe('accepted');
    expect(lines.at(-1)?.type).toBe('report');
    expect(deps.upgrade).toHaveBeenCalledWith({ repoPath: '/Users/sample/checkout', packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true, keepWorkspace: false });
  });

  it('rejects cross-origin browsers and oversized bodies at the transport', async () => {
    const deps = dependencies();
    const base = await listen(deps);
    const crossOrigin = await fetch(`${base}/api/local/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5555' },
      body: '{}',
    });
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({ error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', reason: 'cross_origin_request' } });

    const oversized = await fetch(`${base}/api/local/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ repoPath: `/${'a'.repeat(70_000)}` }),
    });
    expect(oversized.status).toBe(413);
    expect(deps.upgrade).not.toHaveBeenCalled();
  });
});
