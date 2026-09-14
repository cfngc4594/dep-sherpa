import semver from 'semver';
import type { DependencySection, PackageManifest } from '../core/types';

/**
 * Derives the single dependency change a pull request proposes by comparing the
 * base and head manifests. Dependabot and Renovate open one PR per dependency,
 * which is exactly what the isolated runner investigates; grouped updates are
 * reported back so the workflow can pass explicit inputs instead.
 */

const dependencySections: DependencySection[] = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export interface DetectedDependencyChange {
  packageName: string;
  section: DependencySection;
  fromRange: string | null;
  toRange: string;
  targetVersion: string;
}

export type DependencyDetection =
  | { ok: true; change: DetectedDependencyChange }
  | { ok: false; reason: string; changes: string[] };

interface ManifestChange {
  packageName: string;
  section: DependencySection;
  fromRange: string | null;
  toRange: string | null;
}

function collectChanges(base: PackageManifest, head: PackageManifest): ManifestChange[] {
  const changes: ManifestChange[] = [];
  for (const section of dependencySections) {
    const before = base[section] ?? {};
    const after = head[section] ?? {};
    for (const packageName of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const fromRange = before[packageName] ?? null;
      const toRange = after[packageName] ?? null;
      if (fromRange !== toRange) changes.push({ packageName, section, fromRange, toRange });
    }
  }
  return changes;
}

export function exactVersionFromRange(range: string): string | null {
  const trimmed = range.trim();
  const exact = semver.valid(trimmed);
  if (exact) return exact;
  try {
    return semver.minVersion(trimmed)?.version ?? null;
  } catch {
    return null;
  }
}

export function detectDependencyChange(base: PackageManifest, head: PackageManifest): DependencyDetection {
  const changes = collectChanges(base, head);
  const labels = changes.map((change) => `${change.section}.${change.packageName}: ${change.fromRange ?? '(absent)'} → ${change.toRange ?? '(removed)'}`);
  const upgrades = changes.filter((change): change is ManifestChange & { fromRange: string; toRange: string } => change.fromRange !== null && change.toRange !== null);
  if (!changes.length) return { ok: false, reason: 'The pull request does not change any dependency range in package.json.', changes: labels };
  if (upgrades.length !== 1 || changes.length !== 1) {
    return { ok: false, reason: 'The pull request changes more than one dependency, or adds/removes one. Pass `package` and `version` inputs to investigate a single upgrade.', changes: labels };
  }
  const [change] = upgrades;
  const targetVersion = exactVersionFromRange(change.toRange);
  if (!targetVersion) {
    return { ok: false, reason: `The new range "${change.toRange}" for ${change.packageName} does not resolve to an exact version.`, changes: labels };
  }
  return { ok: true, change: { packageName: change.packageName, section: change.section, fromRange: change.fromRange, toRange: change.toRange, targetVersion } };
}
