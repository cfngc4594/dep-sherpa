/**
 * The only GitHub write the Action performs: creating or updating one
 * pull-request comment that carries the report. It goes through Octokit from
 * `@actions/github`; the minimal interface below is what the tests fake.
 */

export interface IssueCommentRecord {
  id: number;
  body?: string | null;
}

export interface IssuesApi {
  listComments(params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page?: number;
    page?: number;
  }): Promise<{ data: IssueCommentRecord[] }>;
  createComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<{
    data: IssueCommentRecord;
  }>;
  updateComment(params: { owner: string; repo: string; comment_id: number; body: string }): Promise<{
    data: IssueCommentRecord;
  }>;
}

export interface CommentTarget {
  owner: string;
  repo: string;
  issueNumber: number;
}

export async function upsertPullRequestComment(
  issues: IssuesApi,
  target: CommentTarget,
  body: string,
  marker: string,
): Promise<{ action: 'created' | 'updated'; id: number }> {
  const base = { owner: target.owner, repo: target.repo, issue_number: target.issueNumber };
  let existing: IssueCommentRecord | null = null;
  for (let page = 1; page <= 3 && !existing; page += 1) {
    const { data } = await issues.listComments({ ...base, per_page: 100, page });
    existing = data.find((comment) => typeof comment.body === 'string' && comment.body.includes(marker)) ?? null;
    if (data.length < 100) break;
  }
  if (existing) {
    const { data } = await issues.updateComment({
      owner: target.owner,
      repo: target.repo,
      comment_id: existing.id,
      body,
    });
    return { action: 'updated', id: data.id };
  }
  const { data } = await issues.createComment({ ...base, body });
  return { action: 'created', id: data.id };
}
