import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as hostedCapabilities } from '../../app/api/local/capabilities/route';
import { POST as hostedInspect } from '../../app/api/local/inspect/route';
import { POST as hostedUpgrade } from '../../app/api/local/upgrade/route';
import { hostedLocalCapabilities, hostedLocalExecutionRejection, hostedUnavailableReason } from './hosted';
import { depSherpaLocalHarness } from './vite-plugin';

/**
 * These are the only handlers a public deployment ships under /api/local/*.
 * They must reject every request and must never be able to reach the core.
 */
describe('hosted /api/local routes', () => {
  it('always reports local execution as unavailable', async () => {
    expect(hostedUnavailableReason()).toBe('hosted_deployment');
    for (const handler of [hostedUpgrade, hostedInspect]) {
      const response = await handler();
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', reason: 'hosted_deployment' },
      });
    }
    const capabilities = await hostedCapabilities();
    expect(capabilities.status).toBe(200);
    await expect(capabilities.json()).resolves.toEqual({ enabled: false, reason: 'hosted_deployment' });
  });

  it('cannot be switched on by the harness environment variable', async () => {
    const previous = process.env.DEPSHERPA_LOCAL_HARNESS;
    process.env.DEPSHERPA_LOCAL_HARNESS = '1';
    try {
      expect(hostedUnavailableReason()).toBe('hosted_deployment');
      await expect(hostedLocalExecutionRejection().json()).resolves.toMatchObject({ error: { reason: 'hosted_deployment' } });
      await expect(hostedLocalCapabilities().json()).resolves.toEqual({ enabled: false, reason: 'hosted_deployment' });
    } finally {
      if (previous === undefined) delete process.env.DEPSHERPA_LOCAL_HARNESS;
      else process.env.DEPSHERPA_LOCAL_HARNESS = previous;
    }
  });

  it('never imports the execution core, so the deployed bundle has nothing to run', async () => {
    const routeDirectory = path.resolve(__dirname, '../../app/api/local');
    for (const route of ['upgrade', 'inspect', 'capabilities']) {
      const source = await readFile(path.join(routeDirectory, route, 'route.ts'), 'utf8');
      expect(source).not.toMatch(/core\/(upgrade|runner|repair|investigate)/);
      expect(source).not.toMatch(/harness\/(runtime|api|node-http|repository)/);
      expect(source).toContain("from '@/src/harness/hosted'");
    }
    const hostedSource = await readFile(path.resolve(__dirname, 'hosted.ts'), 'utf8');
    expect(hostedSource).not.toMatch(/from '\.\/(runtime|api|node-http|repository)'/);
    expect(hostedSource).not.toMatch(/node:/);
  });
});

describe('dev-server harness plugin', () => {
  it('is only applied to the dev server, never to a build', () => {
    const plugin = depSherpaLocalHarness();
    expect(plugin.name).toBe('depsherpa:local-harness');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});
