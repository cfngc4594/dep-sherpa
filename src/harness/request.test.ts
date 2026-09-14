import { describe, expect, it } from 'vitest';
import {
  parseLocalInspectRequest,
  parseLocalUpgradeRequest,
  validatePackageName,
  validateRepoPath,
  validateTargetVersion,
} from './request';

const valid = { repoPath: '/Users/sample/projects/checkout', packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true };

describe('local upgrade request parsing', () => {
  it('accepts the documented fields and normalizes whitespace', () => {
    const parsed = parseLocalUpgradeRequest({ ...valid, repoPath: ' /Users/sample/projects/checkout ', packageName: ' zod ', targetVersion: 'v4.1.5 ' }, { keepWorkspaceAllowed: false });
    expect(parsed).toEqual({
      ok: true,
      value: { repoPath: '/Users/sample/projects/checkout', packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true, keepWorkspace: false },
    });
  });

  it('defaults attemptRepair and keepWorkspace to false when omitted', () => {
    const parsed = parseLocalUpgradeRequest({ repoPath: valid.repoPath, packageName: 'zod', targetVersion: '4.1.5' }, { keepWorkspaceAllowed: false });
    expect(parsed.ok && parsed.value.attemptRepair).toBe(false);
    expect(parsed.ok && parsed.value.keepWorkspace).toBe(false);
  });

  it('rejects anything that is not a plain object', () => {
    for (const body of [null, undefined, 'zod', 42, [], true]) {
      const parsed = parseLocalUpgradeRequest(body, { keepWorkspaceAllowed: false });
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects unknown fields so commands, scripts, env vars, and executables have no way in', () => {
    for (const extra of [{ command: 'rm -rf /' }, { script: 'postinstall' }, { env: { PATH: '/tmp' } }, { executable: '/bin/sh' }, { args: ['--force'] }, { cwd: '/' }]) {
      const parsed = parseLocalUpgradeRequest({ ...valid, ...extra }, { keepWorkspaceAllowed: false });
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.error.message).toContain('Unsupported field');
    }
  });

  it('requires an absolute repository path without traversal or control characters', () => {
    expect(validateRepoPath('relative/path').ok).toBe(false);
    expect(validateRepoPath('./checkout').ok).toBe(false);
    expect(validateRepoPath('/Users/sample/../etc').ok).toBe(false);
    expect(validateRepoPath('/Users/sample/check\0out').ok).toBe(false);
    expect(validateRepoPath('/Users/sample/check\nout').ok).toBe(false);
    expect(validateRepoPath('').ok).toBe(false);
    expect(validateRepoPath(`/${'a'.repeat(1_100)}`).ok).toBe(false);
    expect(validateRepoPath(42).ok).toBe(false);
    expect(validateRepoPath('/Users/sample/projects/checkout')).toEqual({ ok: true, value: '/Users/sample/projects/checkout' });
    expect(validateRepoPath('C:\\projects\\checkout')).toEqual({ ok: true, value: 'C:\\projects\\checkout' });
  });

  it('accepts only valid lowercase npm package names', () => {
    expect(validatePackageName('zod')).toEqual({ ok: true, value: 'zod' });
    expect(validatePackageName('@tanstack/react-query')).toEqual({ ok: true, value: '@tanstack/react-query' });
    for (const name of ['Zod', '../zod', 'zod; rm -rf /', 'zod@4', '@scope', 'zod name', '', 'a'.repeat(215), '$(whoami)']) {
      expect(validatePackageName(name).ok).toBe(false);
    }
  });

  it('accepts only exact semantic versions', () => {
    expect(validateTargetVersion('4.1.5')).toEqual({ ok: true, value: '4.1.5' });
    expect(validateTargetVersion('4.1.5-beta.1')).toEqual({ ok: true, value: '4.1.5-beta.1' });
    for (const version of ['^4.1.5', '~4.1.0', 'latest', 'next', '4', '4.1', '4.1.x', '>=4.0.0', '4.1.5 || 5.0.0', '', 'a'.repeat(65)]) {
      expect(validateTargetVersion(version).ok).toBe(false);
    }
  });

  it('requires booleans for the repair and retention switches', () => {
    expect(parseLocalUpgradeRequest({ ...valid, attemptRepair: 'yes' }, { keepWorkspaceAllowed: false }).ok).toBe(false);
    expect(parseLocalUpgradeRequest({ ...valid, keepWorkspace: 1 }, { keepWorkspaceAllowed: true }).ok).toBe(false);
  });

  it('only allows workspace retention when the harness explicitly permits it', () => {
    const denied = parseLocalUpgradeRequest({ ...valid, keepWorkspace: true }, { keepWorkspaceAllowed: false });
    expect(denied).toMatchObject({ ok: false, error: { code: 'KEEP_WORKSPACE_NOT_ENABLED' } });
    const allowed = parseLocalUpgradeRequest({ ...valid, keepWorkspace: true }, { keepWorkspaceAllowed: true });
    expect(allowed.ok && allowed.value.keepWorkspace).toBe(true);
  });
});

describe('local inspect request parsing', () => {
  it('accepts only the path, package, and version', () => {
    expect(parseLocalInspectRequest({ repoPath: valid.repoPath, packageName: 'zod', targetVersion: '4.1.5' })).toEqual({
      ok: true,
      value: { repoPath: valid.repoPath, packageName: 'zod', targetVersion: '4.1.5' },
    });
    expect(parseLocalInspectRequest({ repoPath: valid.repoPath, packageName: 'zod', targetVersion: '4.1.5', attemptRepair: true }).ok).toBe(false);
    expect(parseLocalInspectRequest({ repoPath: valid.repoPath, packageName: 'zod', targetVersion: '4.1.5', runChecks: true }).ok).toBe(false);
  });
});
