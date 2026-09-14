import { describe, expect, it } from '@jest/globals';
import { analyzeUpgrade } from '../../src/core/manifest.js';
import type { PackageManifest, UpgradeRisk } from '../../src/core/types.js';

const scenarios: Array<{
  name: string;
  manifest: PackageManifest;
  packageName: string;
  target: string;
  expectedRisk: UpgradeRisk;
}> = [
  {
    name: 'patch dependency',
    manifest: { dependencies: { react: '^19.2.5' } },
    packageName: 'react',
    target: '19.2.6',
    expectedRisk: 'low',
  },
  {
    name: 'minor dependency',
    manifest: { dependencies: { vite: '^8.0.0' } },
    packageName: 'vite',
    target: '8.1.0',
    expectedRisk: 'medium',
  },
  {
    name: 'major dependency',
    manifest: { dependencies: { zod: '^3.23.8' } },
    packageName: 'zod',
    target: '4.1.5',
    expectedRisk: 'high',
  },
  {
    name: 'peer patch',
    manifest: { peerDependencies: { react: '^19.2.5' } },
    packageName: 'react',
    target: '19.2.6',
    expectedRisk: 'medium',
  },
  {
    name: 'dev major',
    manifest: { devDependencies: { eslint: '^9.39.4' } },
    packageName: 'eslint',
    target: '10.0.0',
    expectedRisk: 'high',
  },
  {
    name: 'same target',
    manifest: { optionalDependencies: { sharp: '0.34.5' } },
    packageName: 'sharp',
    target: '0.34.5',
    expectedRisk: 'low',
  },
];

describe('risk evaluation scenarios', () => {
  it.each(scenarios)('$name → $expectedRisk', ({ manifest, packageName, target, expectedRisk }) => {
    expect(analyzeUpgrade(manifest, packageName, target).risk).toBe(expectedRisk);
  });

  it('fails clearly when the dependency is absent', () => {
    expect(() => analyzeUpgrade({ dependencies: {} }, 'zod', '4.1.5')).toThrow('not declared');
  });
});
