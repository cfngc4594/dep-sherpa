import { realpath, stat } from 'node:fs/promises';
import { runCommand } from '../core/runner';
import type { LocalApiError } from './contracts';

export type RepositoryValidation =
  | { ok: true; path: string }
  | { ok: false; error: LocalApiError };

/**
 * Confirms that a caller-supplied absolute path exists, is a directory, and is
 * the root of a Git working tree. The same rule the CLI runner enforces is
 * checked here first so the browser receives a specific error instead of a
 * failed clone.
 */
export async function validateRepositoryPath(repoPath: string): Promise<RepositoryValidation> {
  let resolved: string;
  try {
    const metadata = await stat(repoPath);
    if (!metadata.isDirectory()) {
      return { ok: false, error: { code: 'REPOSITORY_NOT_FOUND', message: `${repoPath} is not a directory.` } };
    }
    resolved = await realpath(repoPath);
  } catch {
    return { ok: false, error: { code: 'REPOSITORY_NOT_FOUND', message: `${repoPath} does not exist or is not readable.` } };
  }

  const gitRoot = await runCommand({
    name: 'git_root',
    executable: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd: resolved,
    timeoutMs: 15_000,
  });
  if (gitRoot.status !== 'passed') {
    return { ok: false, error: { code: 'NOT_A_GIT_ROOT', message: `${resolved} is not inside a Git repository.` } };
  }
  let root: string;
  try {
    root = await realpath(gitRoot.output.trim());
  } catch {
    return { ok: false, error: { code: 'NOT_A_GIT_ROOT', message: `${resolved} does not resolve to a readable Git root.` } };
  }
  if (root !== resolved) {
    return {
      ok: false,
      error: { code: 'NOT_A_GIT_ROOT', message: `${resolved} is inside a Git repository whose root is ${root}. Supply the Git root.` },
    };
  }
  return { ok: true, path: resolved };
}
