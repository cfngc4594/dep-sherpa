import { readFile } from 'node:fs/promises';

/** The parts of the GitHub Actions runtime context the report generator relies on. */
export interface PullRequestContext {
  number: number;
  baseSha: string;
  headSha: string;
  baseRef: string | null;
  headRef: string | null;
}

export interface GitHubContext {
  eventName: string | null;
  repository: string | null;
  apiUrl: string;
  serverUrl: string;
  runUrl: string | null;
  workspace: string | null;
  pullRequest: PullRequestContext | null;
}

interface PullRequestEventPayload {
  pull_request?: {
    number?: unknown;
    base?: { sha?: unknown; ref?: unknown };
    head?: { sha?: unknown; ref?: unknown };
  };
}

const shaPattern = /^[0-9a-f]{40}$/i;

export function pullRequestFromPayload(payload: unknown): PullRequestContext | null {
  const pullRequest = (payload as PullRequestEventPayload | null)?.pull_request;
  if (!pullRequest || typeof pullRequest.number !== 'number') return null;
  const baseSha = pullRequest.base?.sha;
  const headSha = pullRequest.head?.sha;
  if (typeof baseSha !== 'string' || typeof headSha !== 'string' || !shaPattern.test(baseSha) || !shaPattern.test(headSha)) return null;
  return {
    number: pullRequest.number,
    baseSha,
    headSha,
    baseRef: typeof pullRequest.base?.ref === 'string' ? pullRequest.base.ref : null,
    headRef: typeof pullRequest.head?.ref === 'string' ? pullRequest.head.ref : null,
  };
}

export async function readGitHubContext(
  env: Record<string, string | undefined>,
  readEventFile: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<GitHubContext> {
  const serverUrl = env.GITHUB_SERVER_URL?.trim() || 'https://github.com';
  const repository = env.GITHUB_REPOSITORY?.trim() || null;
  const runId = env.GITHUB_RUN_ID?.trim() || null;
  let pullRequest: PullRequestContext | null = null;
  const eventName = env.GITHUB_EVENT_NAME?.trim() || null;
  if ((eventName === 'pull_request' || eventName === 'pull_request_target') && env.GITHUB_EVENT_PATH) {
    try {
      pullRequest = pullRequestFromPayload(JSON.parse(await readEventFile(env.GITHUB_EVENT_PATH)) as unknown);
    } catch {
      pullRequest = null;
    }
  }
  return {
    eventName,
    repository,
    apiUrl: env.GITHUB_API_URL?.trim() || 'https://api.github.com',
    serverUrl,
    runUrl: repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : null,
    workspace: env.GITHUB_WORKSPACE?.trim() || null,
    pullRequest,
  };
}
