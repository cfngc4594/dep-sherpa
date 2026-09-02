import { analyzeUpgrade, inferPackageManager, listChecks } from './analysis';
import semver from 'semver';
import type {
  PackageManifest,
  ReleaseEvidence,
  ReleaseNoteEvidence,
  RegistryEvidence,
  RemoteInvestigationReport,
  RepositoryEvidence,
} from './types';

export interface RemoteInvestigationInput {
  repositoryUrl: string;
  packageName: string;
  targetVersion: string;
  manifestPath?: string;
}

export type RemoteInvestigationErrorCode =
  | 'INVALID_INPUT'
  | 'REPOSITORY_NOT_FOUND'
  | 'MANIFEST_NOT_FOUND'
  | 'NPM_VERSION_NOT_FOUND'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE';

export class RemoteInvestigationError extends Error {
  constructor(
    message: string,
    public readonly code: RemoteInvestigationErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'RemoteInvestigationError';
  }
}

interface GitHubRepositoryResponse {
  name?: string;
  full_name?: string;
  html_url?: string;
  default_branch?: string;
  archived?: boolean;
}

interface GitHubContentResponse {
  type?: string;
  path?: string;
  sha?: string;
  size?: number;
  encoding?: string;
  content?: string;
}

interface NpmVersionResponse {
  name?: string;
  version?: string;
  description?: string;
  repository?: string | { url?: string };
  homepage?: string;
  engines?: { node?: string };
  peerDependencies?: Record<string, string>;
}

interface GitHubReleaseResponse {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

type FetchImplementation = typeof fetch;

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'DepSherpa-readonly-investigator',
  'X-GitHub-Api-Version': '2022-11-28',
};

function invalid(message: string): never {
  throw new RemoteInvestigationError(message, 'INVALID_INPUT', 400);
}

export function parseGitHubRepository(repositoryUrl: string): { owner: string; repo: string } {
  const trimmed = repositoryUrl.trim();
  if (!trimmed || trimmed.length > 300) invalid('Enter a GitHub repository URL.');

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    invalid('The repository URL is not valid.');
  }

  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) {
    invalid('Only public https://github.com repositories are supported.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    invalid('Use the repository root URL, for example https://github.com/owner/repository.');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  const githubName = /^[A-Za-z0-9_.-]+$/;
  if (!githubName.test(owner) || !githubName.test(repo)) invalid('The GitHub owner or repository name is not valid.');
  return { owner, repo };
}

export function normalizeManifestPath(value?: string): string {
  const manifestPath = (value?.trim() || 'package.json').replace(/^\/+/, '');
  const segments = manifestPath.split('/');
  if (
    manifestPath.length > 240
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))
    || segments.at(-1) !== 'package.json'
  ) {
    invalid('Manifest path must point to a package.json inside the repository.');
  }
  return manifestPath;
}

function validatePackageName(value: string): string {
  const packageName = value.trim();
  const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  if (!packageName || packageName.length > 214 || !npmName.test(packageName)) {
    invalid('Enter a valid lowercase npm package name.');
  }
  return packageName;
}

function validateTargetVersion(value: string): string {
  const targetVersion = value.trim();
  if (!targetVersion || targetVersion.length > 64) invalid('Enter a target semantic version.');
  return targetVersion;
}

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cleanRepositoryUrl(repository: NpmVersionResponse['repository']): string | null {
  const raw = (typeof repository === 'string' ? repository : repository?.url)?.trim();
  if (!raw) return null;
  return raw
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git(?:#.*)?$/, '');
}

function releaseExcerpt(body?: string | null): string {
  if (!body) return 'No summary was supplied with this release. Open the source to inspect the full notes.';
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return 'The release body contains no readable prose. Open the source to inspect the full notes.';
  return plain.length > 360 ? `${plain.slice(0, 357).trimEnd()}…` : plain;
}

function releaseVersion(tag: string): string | null {
  return semver.coerce(tag, { rtl: true })?.version ?? null;
}

export async function collectReleaseEvidence(
  repositoryUrl: string | null,
  currentVersion: string | null,
  targetVersion: string,
  fetchImpl: FetchImplementation = fetch,
): Promise<ReleaseEvidence> {
  if (!repositoryUrl) {
    return {
      status: 'unavailable',
      sourceRepositoryUrl: null,
      notes: [],
      message: 'npm does not declare a source repository for this package.',
    };
  }

  let coordinates: { owner: string; repo: string };
  try {
    coordinates = parseGitHubRepository(repositoryUrl);
  } catch {
    return {
      status: 'unavailable',
      sourceRepositoryUrl: repositoryUrl,
      notes: [],
      message: 'The npm source repository is not hosted on GitHub, so GitHub Releases could not be checked.',
    };
  }

  let releases: GitHubReleaseResponse[];
  try {
    const result = await fetchJson<GitHubReleaseResponse[]>(
      fetchImpl,
      `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}/releases?per_page=50`,
      githubHeaders,
      {
        code: 'REPOSITORY_NOT_FOUND',
        message: 'The npm source repository could not be read on GitHub.',
      },
    );
    releases = Array.isArray(result.body) ? result.body : [];
  } catch (error) {
    return {
      status: 'unavailable',
      sourceRepositoryUrl: repositoryUrl,
      notes: [],
      message: error instanceof Error
        ? `Release evidence is temporarily unavailable: ${error.message}`
        : 'Release evidence is temporarily unavailable.',
    };
  }

  const notes = releases
    .filter((release) => !release.draft && release.tag_name && release.html_url)
    .map((release): ReleaseNoteEvidence | null => {
      const version = releaseVersion(release.tag_name!);
      if (!version) return null;
      const isTarget = semver.eq(version, targetVersion);
      const isInRange = currentVersion
        ? semver.gt(version, currentVersion) && semver.lte(version, targetVersion)
        : false;
      if (!isTarget && !isInRange) return null;
      return {
        title: release.name?.trim() || release.tag_name!,
        tag: release.tag_name!,
        version,
        url: release.html_url!,
        publishedAt: release.published_at ?? null,
        excerpt: releaseExcerpt(release.body),
        prerelease: Boolean(release.prerelease),
      };
    })
    .filter((note): note is ReleaseNoteEvidence => note !== null)
    .sort((left, right) => semver.rcompare(left.version, right.version))
    .slice(0, 6);

  if (!notes.length) {
    return {
      status: 'not-found',
      sourceRepositoryUrl: repositoryUrl,
      notes: [],
      message: `No matching GitHub Release was found among the 50 most recent releases for ${targetVersion}.`,
    };
  }

  return {
    status: 'found',
    sourceRepositoryUrl: repositoryUrl,
    notes,
    message: `${notes.length} GitHub ${notes.length === 1 ? 'release' : 'releases'} matched the requested upgrade range.`,
  };
}

async function fetchJson<T>(
  fetchImpl: FetchImplementation,
  url: string,
  headers: Record<string, string>,
  notFound: { code: RemoteInvestigationErrorCode; message: string },
): Promise<{ body: T; response: Response }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new RemoteInvestigationError(
      'The evidence source did not respond. Try again in a moment.',
      'UPSTREAM_UNAVAILABLE',
      502,
    );
  }

  if (response.status === 404) {
    throw new RemoteInvestigationError(notFound.message, notFound.code, 404);
  }
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new RemoteInvestigationError(
      'GitHub or npm has temporarily rate-limited this public inspector. Try again later.',
      'UPSTREAM_RATE_LIMITED',
      429,
    );
  }
  if (!response.ok) {
    throw new RemoteInvestigationError(
      'GitHub or npm returned an unexpected response. Try again in a moment.',
      'UPSTREAM_UNAVAILABLE',
      502,
    );
  }

  try {
    return { body: await response.json() as T, response };
  } catch {
    throw new RemoteInvestigationError(
      'The evidence source returned data DepSherpa could not read.',
      'UPSTREAM_UNAVAILABLE',
      502,
    );
  }
}

export async function investigateRemote(
  input: RemoteInvestigationInput,
  fetchImpl: FetchImplementation = fetch,
): Promise<RemoteInvestigationReport> {
  const { owner, repo } = parseGitHubRepository(input.repositoryUrl);
  const manifestPath = normalizeManifestPath(input.manifestPath);
  const packageName = validatePackageName(input.packageName);
  const targetVersion = validateTargetVersion(input.targetVersion);
  const encodedPackage = encodeURIComponent(packageName);

  const repositoryPromise = fetchJson<GitHubRepositoryResponse>(
    fetchImpl,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    githubHeaders,
    {
      code: 'REPOSITORY_NOT_FOUND',
      message: 'That public GitHub repository was not found. Private repositories are not available in web mode.',
    },
  );
  const versionPromise = fetchJson<NpmVersionResponse>(
    fetchImpl,
    `https://registry.npmjs.org/${encodedPackage}/${encodeURIComponent(targetVersion)}`,
    { Accept: 'application/json' },
    {
      code: 'NPM_VERSION_NOT_FOUND',
      message: `npm does not list ${packageName}@${targetVersion}.`,
    },
  );
  const tagsPromise = fetchJson<Record<string, string>>(
    fetchImpl,
    `https://registry.npmjs.org/-/package/${encodedPackage}/dist-tags`,
    { Accept: 'application/json' },
    {
      code: 'NPM_VERSION_NOT_FOUND',
      message: `npm does not list the package ${packageName}.`,
    },
  );

  const [{ body: repository }, { body: npmVersion }, { body: distTags }] = await Promise.all([
    repositoryPromise,
    versionPromise,
    tagsPromise,
  ]);

  if (!repository.default_branch || !repository.html_url || !repository.name) {
    throw new RemoteInvestigationError(
      'GitHub returned incomplete repository metadata.',
      'UPSTREAM_UNAVAILABLE',
      502,
    );
  }

  const contentPath = manifestPath.split('/').map(encodeURIComponent).join('/');
  const { body: content } = await fetchJson<GitHubContentResponse>(
    fetchImpl,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${contentPath}?ref=${encodeURIComponent(repository.default_branch)}`,
    githubHeaders,
    {
      code: 'MANIFEST_NOT_FOUND',
      message: `No ${manifestPath} was found on the repository's default branch.`,
    },
  );

  if (content.type !== 'file' || content.encoding !== 'base64' || !content.content || !content.sha) {
    throw new RemoteInvestigationError(
      `${manifestPath} is not a readable package manifest.`,
      'MANIFEST_NOT_FOUND',
      404,
    );
  }

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(decodeBase64Utf8(content.content)) as PackageManifest;
  } catch {
    throw new RemoteInvestigationError(
      `${manifestPath} is not valid JSON.`,
      'INVALID_INPUT',
      422,
    );
  }

  let finding;
  try {
    finding = analyzeUpgrade(manifest, packageName, targetVersion);
  } catch (error) {
    throw new RemoteInvestigationError(
      error instanceof Error ? error.message : 'The dependency request could not be analyzed.',
      'INVALID_INPUT',
      422,
    );
  }

  if (npmVersion.name !== packageName || npmVersion.version !== finding.targetVersion) {
    throw new RemoteInvestigationError(
      `npm did not confirm ${packageName}@${finding.targetVersion}.`,
      'NPM_VERSION_NOT_FOUND',
      404,
    );
  }

  const checks = listChecks(manifest);
  const source: RepositoryEvidence = {
    owner,
    name: repository.name,
    url: repository.html_url,
    defaultBranch: repository.default_branch,
    manifestPath,
    manifestSha: content.sha,
    manifestSize: content.size ?? 0,
    archived: Boolean(repository.archived),
  };
  const registry: RegistryEvidence = {
    packageName,
    targetVersion: finding.targetVersion,
    latestVersion: distTags.latest ?? null,
    description: npmVersion.description?.slice(0, 280) ?? null,
    repositoryUrl: cleanRepositoryUrl(npmVersion.repository),
    homepage: npmVersion.homepage ?? null,
    nodeRequirement: npmVersion.engines?.node ?? null,
    peerDependencyCount: Object.keys(npmVersion.peerDependencies ?? {}).length,
  };
  const releases = await collectReleaseEvidence(
    registry.repositoryUrl,
    finding.currentVersion,
    finding.targetVersion,
    fetchImpl,
  );

  return {
    mode: 'remote-readonly',
    generatedAt: new Date().toISOString(),
    repository: repository.full_name ?? `${owner}/${repo}`,
    manifestPath,
    packageManager: inferPackageManager(manifest),
    finding,
    checks,
    results: checks.map((check) => ({
      name: check.name,
      command: check.command,
      status: 'skipped',
      exitCode: null,
      durationMs: 0,
      output: check.available
        ? 'Discovered remotely; execution requires the isolated local runner.'
        : 'This script is not declared in the selected package.json.',
    })),
    externalWritesAllowed: false,
    source,
    registry,
    releases,
  };
}
