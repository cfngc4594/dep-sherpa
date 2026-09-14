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
  /** `owner/repo`, when known. */
  repository: string | null;
  runUrl: string | null;
  workspace: string | null;
  pullRequest: PullRequestContext | null;
}

/** The subset of `@actions/github`'s `context` object that is read. */
export interface RuntimeContextSource {
  eventName: string;
  payload: unknown;
  runId: number;
  serverUrl: string;
  repo: { owner: string; repo: string };
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
  if (
    typeof baseSha !== 'string' ||
    typeof headSha !== 'string' ||
    !shaPattern.test(baseSha) ||
    !shaPattern.test(headSha)
  ) {
    return null;
  }
  return {
    number: pullRequest.number,
    baseSha,
    headSha,
    baseRef: typeof pullRequest.base?.ref === 'string' ? pullRequest.base.ref : null,
    headRef: typeof pullRequest.head?.ref === 'string' ? pullRequest.head.ref : null,
  };
}

/** Builds the context from `@actions/github`'s `context` plus the workspace variable. */
export function contextFromGitHub(
  source: RuntimeContextSource,
  env: Record<string, string | undefined>,
): GitHubContext {
  let repository: string | null;
  try {
    repository = source.repo.owner && source.repo.repo ? `${source.repo.owner}/${source.repo.repo}` : null;
  } catch {
    // `context.repo` throws outside GitHub Actions when GITHUB_REPOSITORY is unset.
    repository = null;
  }
  const eventName = source.eventName || null;
  const pullRequest =
    eventName === 'pull_request' || eventName === 'pull_request_target' ? pullRequestFromPayload(source.payload) : null;
  return {
    eventName,
    repository,
    runUrl: repository && source.runId ? `${source.serverUrl}/${repository}/actions/runs/${source.runId}` : null,
    workspace: env.GITHUB_WORKSPACE?.trim() || null,
    pullRequest,
  };
}
