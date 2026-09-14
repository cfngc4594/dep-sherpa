import { describe, expect, it } from 'vitest';
import {
  detectExecutionContext,
  detectRuntime,
  evaluateLocalExecutionGate,
  evaluateLocalRequest,
  isLoopbackAddress,
  isLoopbackHostname,
  localExecutionUnavailableResponse,
  type LocalExecutionContext,
} from './gate';

const attachedDevNode: LocalExecutionContext = {
  runtime: 'node',
  nodeEnv: 'development',
  harnessFlag: undefined,
  harnessAttached: true,
};

describe('local execution gate', () => {
  it('rejects every Workers runtime as a hosted deployment, even with the harness flag set', () => {
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, runtime: 'workerd' })).toEqual({ enabled: false, reason: 'hosted_deployment' });
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, runtime: 'workerd', harnessFlag: '1' })).toEqual({ enabled: false, reason: 'hosted_deployment' });
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, runtime: 'unknown' })).toEqual({ enabled: false, reason: 'hosted_deployment' });
  });

  it('rejects Node processes that do not carry the harness middleware', () => {
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, harnessAttached: false })).toEqual({ enabled: false, reason: 'hosted_deployment' });
  });

  it('rejects production Node servers', () => {
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, nodeEnv: 'production' })).toEqual({ enabled: false, reason: 'production_environment' });
  });

  it('honours the explicit developer kill switch', () => {
    for (const flag of ['0', 'false', 'off', 'OFF', 'no', 'disabled']) {
      expect(evaluateLocalExecutionGate({ ...attachedDevNode, harnessFlag: flag })).toEqual({ enabled: false, reason: 'harness_disabled' });
    }
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, harnessFlag: '1' })).toEqual({ enabled: true });
  });

  it('enables only an attached Node development harness', () => {
    expect(evaluateLocalExecutionGate(attachedDevNode)).toEqual({ enabled: true });
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, nodeEnv: undefined })).toEqual({ enabled: true });
    expect(evaluateLocalExecutionGate({ ...attachedDevNode, nodeEnv: 'test' })).toEqual({ enabled: true });
  });

  it('detects the Workers runtime from its user agent or WebSocketPair global', () => {
    expect(detectRuntime({ navigator: { userAgent: 'Cloudflare-Workers' } } as unknown as typeof globalThis)).toBe('workerd');
    expect(detectRuntime({ WebSocketPair: function WebSocketPair() {}, process: { versions: { node: '22.0.0' }, release: { name: 'node' } } } as unknown as typeof globalThis)).toBe('workerd');
    expect(detectRuntime({ process: { versions: { node: '22.0.0' }, release: { name: 'node' } } } as unknown as typeof globalThis)).toBe('node');
    expect(detectRuntime({} as typeof globalThis)).toBe('unknown');
    expect(detectRuntime()).toBe('node');
  });

  it('reads the environment it is given rather than ambient state', () => {
    const context = detectExecutionContext({ harnessAttached: true, env: { NODE_ENV: 'production', DEPSHERPA_LOCAL_HARNESS: '0' } });
    expect(context).toMatchObject({ runtime: 'node', nodeEnv: 'production', harnessFlag: '0', harnessAttached: true });
    expect(evaluateLocalExecutionGate(context)).toEqual({ enabled: false, reason: 'production_environment' });
  });
});

describe('local request checks', () => {
  const sameOrigin = { url: 'http://localhost:3000/api/local/upgrade', origin: 'http://localhost:3000', secFetchSite: 'same-origin', remoteAddress: '127.0.0.1' };

  it('accepts loopback, same-origin requests', () => {
    expect(evaluateLocalRequest(sameOrigin)).toEqual({ enabled: true });
    expect(evaluateLocalRequest({ ...sameOrigin, url: 'http://127.0.0.1:3000/api/local/upgrade', origin: 'http://127.0.0.1:3000', remoteAddress: '::ffff:127.0.0.1' })).toEqual({ enabled: true });
    expect(evaluateLocalRequest({ ...sameOrigin, url: 'http://[::1]:3000/api/local/upgrade', origin: 'http://[::1]:3000', remoteAddress: '::1' })).toEqual({ enabled: true });
  });

  it('accepts tools that send no Origin header from the same machine', () => {
    expect(evaluateLocalRequest({ ...sameOrigin, origin: null, secFetchSite: null })).toEqual({ enabled: true });
  });

  it('rejects requests addressed to a non-loopback host or from a non-loopback socket', () => {
    expect(evaluateLocalRequest({ ...sameOrigin, url: 'http://192.168.1.20:3000/api/local/upgrade', origin: 'http://192.168.1.20:3000' })).toEqual({ enabled: false, reason: 'non_loopback_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, url: 'http://depsherpa.example/api/local/upgrade', origin: 'http://depsherpa.example' })).toEqual({ enabled: false, reason: 'non_loopback_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, remoteAddress: '10.0.0.7' })).toEqual({ enabled: false, reason: 'non_loopback_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, url: 'not a url' })).toEqual({ enabled: false, reason: 'non_loopback_request' });
  });

  it('rejects cross-origin browser requests, including other localhost ports', () => {
    expect(evaluateLocalRequest({ ...sameOrigin, origin: 'https://evil.example', secFetchSite: 'cross-site' })).toEqual({ enabled: false, reason: 'cross_origin_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, origin: 'http://localhost:5555', secFetchSite: 'same-site' })).toEqual({ enabled: false, reason: 'cross_origin_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, origin: 'http://localhost:5555', secFetchSite: null })).toEqual({ enabled: false, reason: 'cross_origin_request' });
    expect(evaluateLocalRequest({ ...sameOrigin, origin: 'null', secFetchSite: null })).toEqual({ enabled: false, reason: 'cross_origin_request' });
  });

  it('recognises loopback names and addresses only', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('localhost.evil.example')).toBe(false);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.0.0.2')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it('describes the rejection in a stable machine-readable body', async () => {
    const response = localExecutionUnavailableResponse('hosted_deployment');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', reason: 'hosted_deployment' },
    });
  });
});
