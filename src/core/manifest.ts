import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackageManifest } from './types.js';

export { analyzeUpgrade, inferPackageManager, listChecks, locateDependency } from './analysis.js';

export async function readManifest(repoPath: string): Promise<{
  manifest: PackageManifest;
  manifestPath: string;
}> {
  const manifestPath = path.resolve(repoPath, 'package.json');
  const source = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(source) as PackageManifest;
  return { manifest, manifestPath };
}

interface NpmPackageLock {
  packages?: Record<string, { version?: unknown }>;
  dependencies?: Record<string, { version?: unknown }>;
}

/** Resolves the version npm actually installs for a top-level dependency from a lockfile (v1, v2, or v3). */
export function versionFromPackageLock(lockfile: unknown, packageName: string): string | null {
  const lock = lockfile as NpmPackageLock | null;
  const modern = lock?.packages?.[`node_modules/${packageName}`]?.version;
  if (typeof modern === 'string') return modern;
  const legacy = lock?.dependencies?.[packageName]?.version;
  return typeof legacy === 'string' ? legacy : null;
}

/**
 * Reads the installed baseline of a dependency from the repository's committed
 * `package-lock.json`. Returns null when the lockfile is missing, unreadable, or
 * does not pin the package, so callers fall back to the declared range.
 */
export async function readInstalledVersion(repoPath: string, packageName: string): Promise<string | null> {
  try {
    const source = await readFile(path.resolve(repoPath, 'package-lock.json'), 'utf8');
    return versionFromPackageLock(JSON.parse(source) as unknown, packageName);
  } catch {
    return null;
  }
}
