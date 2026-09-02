import { describe, expect, it, vi } from 'vitest';
import {
  collectReleaseEvidence,
  investigateRemote,
  normalizeManifestPath,
  parseGitHubRepository,
} from './remote';

const manifest = {
  name: '@sample/toolbox',
  packageManager: 'pnpm@10.0.0',
  scripts: { lint: 'eslint .', test: 'vitest run' },
  dependencies: { zod: '^3.23.8' },
};

const manifestContent = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64');

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function successfulFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/sample/toolbox') {
      return jsonResponse({
        name: 'toolbox',
        full_name: 'sample/toolbox',
        html_url: 'https://github.com/sample/toolbox',
        default_branch: 'main',
        archived: false,
      });
    }
    if (url.includes('/contents/package.json')) {
      return jsonResponse({
        type: 'file',
        path: 'package.json',
        sha: 'abc123',
        size: 241,
        encoding: 'base64',
        content: manifestContent,
      });
    }
    if (url === 'https://registry.npmjs.org/zod/4.1.5') {
      return jsonResponse({
        name: 'zod',
        version: '4.1.5',
        description: 'TypeScript-first schema validation',
        repository: { url: 'git+https://github.com/colinhacks/zod.git' },
        homepage: 'https://zod.dev',
        engines: { node: '>=18' },
        peerDependencies: { typescript: '>=5.5' },
      });
    }
    if (url === 'https://registry.npmjs.org/-/package/zod/dist-tags') {
      return jsonResponse({ latest: '4.1.5' });
    }
    if (url === 'https://api.github.com/repos/colinhacks/zod/releases?per_page=50') {
      return jsonResponse([
        {
          name: 'Zod 4.1.5',
          tag_name: 'v4.1.5',
          html_url: 'https://github.com/colinhacks/zod/releases/tag/v4.1.5',
          published_at: '2026-08-20T10:00:00Z',
          body: '## Fixes\n\nSee the [migration guide](https://zod.dev/v4).',
          draft: false,
          prerelease: false,
        },
        {
          name: 'Zod 4',
          tag_name: 'v4.0.0',
          html_url: 'https://github.com/colinhacks/zod/releases/tag/v4.0.0',
          published_at: '2026-06-01T10:00:00Z',
          body: 'Major release with documented breaking changes.',
          draft: false,
          prerelease: false,
        },
      ]);
    }
    return new Response('not found', { status: 404 });
  });
}

describe('remote investigation', () => {
  it('normalizes GitHub repository URLs and manifest paths', () => {
    expect(parseGitHubRepository('github.com/sample/toolbox.git')).toEqual({ owner: 'sample', repo: 'toolbox' });
    expect(normalizeManifestPath('/packages/web/package.json')).toBe('packages/web/package.json');
  });

  it('rejects non-GitHub hosts and path traversal', () => {
    expect(() => parseGitHubRepository('https://example.com/sample/toolbox')).toThrow('Only public');
    expect(() => normalizeManifestPath('../package.json')).toThrow('inside the repository');
  });

  it('builds a read-only report from GitHub and npm evidence', async () => {
    const fetchImpl = successfulFetch();
    const report = await investigateRemote({
      repositoryUrl: 'https://github.com/sample/toolbox',
      packageName: 'zod',
      targetVersion: '4.1.5',
    }, fetchImpl);

    expect(report.mode).toBe('remote-readonly');
    expect(report.repository).toBe('sample/toolbox');
    expect(report.finding.risk).toBe('high');
    expect(report.source.manifestSha).toBe('abc123');
    expect(report.registry.repositoryUrl).toBe('https://github.com/colinhacks/zod');
    expect(report.releases.status).toBe('found');
    expect(report.releases.notes.map((note) => note.version)).toEqual(['4.1.5', '4.0.0']);
    expect(report.releases.notes[0].excerpt).toBe('Fixes See the migration guide.');
    expect(report.checks.find((check) => check.name === 'test')?.available).toBe(true);
    expect(report.results.every((result) => result.status === 'skipped')).toBe(true);
    expect(report.externalWritesAllowed).toBe(false);
  });

  it('returns a specific error for inaccessible repositories', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) return new Response('not found', { status: 404 });
      return jsonResponse(url.includes('dist-tags') ? { latest: '4.1.5' } : { name: 'zod', version: '4.1.5' });
    });

    await expect(investigateRemote({
      repositoryUrl: 'https://github.com/sample/missing',
      packageName: 'zod',
      targetVersion: '4.1.5',
    }, fetchImpl)).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_FOUND',
      status: 404,
    });
  });

  it('keeps the report honest when npm has no source repository', async () => {
    await expect(collectReleaseEvidence(null, '1.0.0', '2.0.0')).resolves.toEqual({
      status: 'unavailable',
      sourceRepositoryUrl: null,
      notes: [],
      message: 'npm does not declare a source repository for this package.',
    });
  });
});
