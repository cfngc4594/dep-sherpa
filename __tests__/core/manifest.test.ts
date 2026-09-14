import { describe, expect, it } from '@jest/globals';
import { analyzeUpgrade, inferPackageManager, listChecks, locateDependency } from '../../src/core/manifest.js';
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
});
