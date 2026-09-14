import path from 'node:path';
import { runCommand } from '../core/runner.js';

/**
 * Prepares the repository state the isolated runner should treat as "source".
 *
 * On a pull request the report must describe the upgrade relative to the base
 * branch, so the base commit is checked out in a separate local clone. The
 * workspace itself is never modified beyond a temporary branch ref that is
 * removed afterwards; `actions/checkout` defaults to a shallow fetch, so the
 * base commit is fetched by SHA when it is missing.
 */

async function git(args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  const result = await runCommand({ name: `git_${args[0]}`, executable: 'git', args, cwd, timeoutMs });
  if (result.status !== 'passed') throw new Error(result.output || `git ${args.join(' ')} failed.`);
  return result.output.trim();
}

async function commitExists(workspace: string, sha: string): Promise<boolean> {
  const result = await runCommand({
    name: 'git_cat_file',
    executable: 'git',
    args: ['cat-file', '-e', `${sha}^{commit}`],
    cwd: workspace,
    timeoutMs: 30_000,
  });
  return result.status === 'passed';
}

export interface SourceCheckout {
  path: string;
  sha: string;
}

export async function readManifestAtCommit(workspace: string, sha: string, filePath = 'package.json'): Promise<string> {
  return git(['show', `${sha}:${filePath}`], workspace);
}

export async function prepareSourceCheckout(options: {
  workspace: string;
  temporaryRoot: string;
  /** Commit to investigate from; defaults to the workspace HEAD. */
  sha?: string | null;
}): Promise<SourceCheckout> {
  const sha = options.sha ?? (await git(['rev-parse', 'HEAD'], options.workspace));
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Refusing to check out a non-SHA revision: ${sha}`);
  if (!(await commitExists(options.workspace, sha))) {
    // Shallow checkouts do not contain the base commit; fetch just that commit through the workspace's own remote.
    await git(['fetch', '--no-tags', '--depth=1', 'origin', sha], options.workspace, 300_000);
    if (!(await commitExists(options.workspace, sha)))
      throw new Error(`Commit ${sha} is not available in the workspace even after fetching it.`);
  }
  const branch = `depsherpa/source-${sha.slice(0, 12)}`;
  const target = path.join(options.temporaryRoot, 'source');
  await git(['branch', '-f', branch, sha], options.workspace);
  try {
    await git(
      ['clone', '--quiet', '--no-hardlinks', '--branch', branch, '--single-branch', options.workspace, target],
      options.temporaryRoot,
      300_000,
    );
  } finally {
    await runCommand({
      name: 'git_branch_cleanup',
      executable: 'git',
      args: ['branch', '-D', branch],
      cwd: options.workspace,
      timeoutMs: 30_000,
    });
  }
  const checkedOut = await git(['rev-parse', 'HEAD'], target);
  if (checkedOut !== sha) throw new Error(`The source checkout is at ${checkedOut}, expected ${sha}.`);
  return { path: target, sha };
}
