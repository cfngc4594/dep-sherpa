import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackageManifest } from './types';

export { analyzeUpgrade, inferPackageManager, listChecks, locateDependency } from './analysis';

export async function readManifest(repoPath: string): Promise<{
  manifest: PackageManifest;
  manifestPath: string;
}> {
  const manifestPath = path.resolve(repoPath, 'package.json');
  const source = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(source) as PackageManifest;
  return { manifest, manifestPath };
}
