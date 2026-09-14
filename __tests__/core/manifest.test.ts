import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  analyzeUpgrade,
  inferPackageManager,
  listChecks,
  locateDependency,
  readInstalledVersion,
  versionFromPackageLock,
} from '../../src/core/manifest.js';
import type { PackageManifest } from '../../src/core/types.js';

const manifest: PackageManifest = {
  name: '@acme/checkout-ui',
  packageManager: 'pnpm@10.15.1',
  scripts: { typecheck: 'tsc --noEmit', test: 'vitest run', build: 'next build' },
  dependencies: { zod: '^3.23.8' },
};

describe('manifest investigation', () => {
  it('locates dependencies and their section', () => {
    expect(locateDependency(manifest, 'zod')).toEqual({ section: 'dependencies', range: '^3.23.8' });
  });

  it('classifies a major version crossing as high risk', () => {
    const finding = analyzeUpgrade(manifest, 'zod', '4.1.5');
    expect(finding.releaseType).toBe('major');
    expect(finding.risk).toBe('high');
    expect(finding.currentVersion).toBe('3.23.8');
  });

  it('lists declared checks without inventing missing scripts', () => {
    expect(inferPackageManager(manifest)).toBe('pnpm');
    expect(listChecks(manifest)).toEqual([
      { name: 'lint', command: 'pnpm run lint', available: false },
      { name: 'typecheck', command: 'pnpm run typecheck', available: true },
      { name: 'test', command: 'pnpm run test', available: true },
      { name: 'build', command: 'pnpm run build', available: true },
    ]);
  });

  it('rejects invalid target versions', () => {
    expect(() => analyzeUpgrade(manifest, 'zod', 'tomorrow')).toThrow('valid semver');
  });

  it('prefers the installed lockfile version over the declared minimum as the baseline', () => {
    const finding = analyzeUpgrade({ devDependencies: { globals: '^16.0.0' } }, 'globals', '17.12.0', '16.5.0');
    expect(finding.currentVersion).toBe('16.5.0');
    expect(finding.releaseType).toBe('major');
    expect(finding.reasons[0]).toBe('The baseline 16.5.0 is the version resolved in package-lock.json.');

    const downgrade = analyzeUpgrade({ devDependencies: { globals: '^16.0.0' } }, 'globals', '16.3.0', '16.5.0');
    expect(downgrade.risk).toBe('low');
    expect(downgrade.reasons).toContain('The target does not exceed the installed version.');

    expect(analyzeUpgrade(manifest, 'zod', '4.1.5', 'not a version').currentVersion).toBe('3.23.8');
  });

  it('reads the installed version from lockfile v1 and v3 shapes', async () => {
    expect(versionFromPackageLock({ packages: { 'node_modules/zod': { version: '3.23.8' } } }, 'zod')).toBe('3.23.8');
    expect(versionFromPackageLock({ dependencies: { zod: { version: '3.22.0' } } }, 'zod')).toBe('3.22.0');
    expect(versionFromPackageLock({ packages: {} }, 'zod')).toBeNull();
    expect(versionFromPackageLock(null, 'zod')).toBeNull();

    const root = await mkdtemp(path.join(tmpdir(), 'depsherpa-lock-test-'));
    try {
      await expect(readInstalledVersion(root, 'zod')).resolves.toBeNull();
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/zod': { version: '3.23.8' } } }),
      );
      await expect(readInstalledVersion(root, 'zod')).resolves.toBe('3.23.8');
      await expect(readInstalledVersion(root, 'semver')).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
