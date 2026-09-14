/**
 * The only GitHub write the Action performs: creating or updating one
 * pull-request comment that carries the report. It requires the workflow to
 * grant `pull-requests: write`; without it the failure is reported and the job
 * summary and artifact remain the record.
 */

export interface CommentTarget {
  apiUrl: string;
  repository: string;
  pullNumber: number;
  token: string;
}

interface IssueComment {
  id: number;
  body?: string | null;
}

async function githubRequest<T>(
  fetchImpl: typeof fetch,
  target: CommentTarget,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetchImpl(`${target.apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${target.token}`,
      'content-type': 'application/json',
      'user-agent': 'depsherpa-action',
      'x-github-api-version': '2022-11-28',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed with ${response.status}: ${detail}`);
  }
  return await response.json() as T;
}

export async function upsertPullRequestComment(
  target: CommentTarget,
  body: string,
  marker: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ action: 'created' | 'updated'; id: number }> {
  const [owner, repo] = target.repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository name: ${target.repository}`);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${target.pullNumber}/comments`;
  let existing: IssueComment | null = null;
  for (let page = 1; page <= 3 && !existing; page += 1) {
    const comments = await githubRequest<IssueComment[]>(fetchImpl, target, `${base}?per_page=100&page=${page}`);
    existing = comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(marker)) ?? null;
    if (comments.length < 100) break;
  }
  if (existing) {
    const updated = await githubRequest<IssueComment>(fetchImpl, target, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
    return { action: 'updated', id: updated.id };
  }
  const created = await githubRequest<IssueComment>(fetchImpl, target, base, { method: 'POST', body: { body } });
  return { action: 'created', id: created.id };
}
