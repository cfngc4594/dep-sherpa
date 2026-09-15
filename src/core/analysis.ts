import semver from 'semver';
import type { DependencyFinding, DependencySection, PackageManifest, ProjectCheck, UpgradeRisk } from './types.js';

const dependencySections: DependencySection[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export function locateDependency(
  manifest: PackageManifest,
  packageName: string,
): { section: DependencySection; range: string } | null {
  for (const section of dependencySections) {
    const range = manifest[section]?.[packageName];
    if (range) return { section, range };
  }
  return null;
}

export function inferPackageManager(manifest: PackageManifest): string {
  const declared = manifest.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') {
    return declared;
  }
  return 'npm';
}

export function listChecks(manifest: PackageManifest): ProjectCheck[] {
  const manager = inferPackageManager(manifest);
  const scripts = manifest.scripts ?? {};
  return ['lint', 'typecheck', 'test', 'build'].map((name) => ({
    name,
    command: `${manager} run ${name}`,
    available: Boolean(scripts[name]),
  }));
}

export function analyzeUpgrade(
  manifest: PackageManifest,
  packageName: string,
  targetVersion: string,
  installedVersion: string | null = null,
): DependencyFinding {
  const located = locateDependency(manifest, packageName);
  if (!located) throw new Error(`${packageName} is not declared in package.json`);

  const installed = installedVersion ? semver.valid(installedVersion) : null;
  const current = installed ?? semver.minVersion(located.range)?.version ?? null;
  const target = semver.valid(targetVersion);
  if (!target) throw new Error(`Target version is not valid semver: ${targetVersion}`);

  const releaseType = current ? semver.diff(current, target) : null;
  let risk: UpgradeRisk = 'unknown';
  const reasons: string[] = [];

  if (installed) {
    reasons.push(`The baseline ${installed} is the version resolved in package-lock.json.`);
  }
  if (!current) {
    reasons.push('The declared range could not be reduced to a concrete semantic version.');
  } else if (semver.lte(target, current)) {
    risk = 'low';
    reasons.push(
      installed
        ? 'The target does not exceed the installed version.'
        : 'The target does not exceed the minimum declared version.',
    );
  } else if (releaseType === 'major' || releaseType === 'premajor') {
    risk = 'high';
    reasons.push('The target crosses a major-version boundary.');
  } else if (releaseType === 'minor' || releaseType === 'preminor') {
    risk = 'medium';
    reasons.push('The target introduces a new minor release.');
  } else {
    risk = 'low';
    reasons.push('The target is a patch-level change.');
  }

  if (located.section === 'peerDependencies') {
    risk = risk === 'low' ? 'medium' : risk;
    reasons.push('Peer dependency changes can alter the package compatibility contract.');
  }

  const normalizedReleaseType =
    releaseType === 'major' || releaseType === 'premajor'
      ? 'major'
      : releaseType === 'minor' || releaseType === 'preminor'
        ? 'minor'
        : releaseType === 'patch' || releaseType === 'prepatch'
          ? 'patch'
          : null;

  return {
    packageName,
    section: located.section,
    declaredRange: located.range,
    currentVersion: current,
    targetVersion: target,
    releaseType: normalizedReleaseType,
    risk,
    reasons,
  };
}
