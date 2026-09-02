import { investigateRemote, RemoteInvestigationError } from '@/src/core/remote';

export const runtime = 'edge';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Send a valid JSON investigation request.' } },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Investigation details are required.' } },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.repositoryUrl !== 'string'
    || typeof input.packageName !== 'string'
    || typeof input.targetVersion !== 'string'
    || (input.manifestPath !== undefined && typeof input.manifestPath !== 'string')
  ) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Repository, dependency, and target version must be text.' } },
      { status: 400 },
    );
  }

  try {
    const report = await investigateRemote({
      repositoryUrl: input.repositoryUrl,
      packageName: input.packageName,
      targetVersion: input.targetVersion,
      manifestPath: input.manifestPath,
    });
    return Response.json({ report }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof RemoteInvestigationError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return Response.json(
      { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The investigation could not be completed.' } },
      { status: 500 },
    );
  }
}
