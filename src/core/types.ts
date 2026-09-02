export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export type UpgradeRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface PackageManifest {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface DependencyFinding {
  packageName: string;
  section: DependencySection;
  declaredRange: string;
  currentVersion: string | null;
  targetVersion: string;
  releaseType: 'major' | 'minor' | 'patch' | null;
  risk: UpgradeRisk;
  reasons: string[];
}

export interface ProjectCheck {
  name: string;
  command: string;
  available: boolean;
}

export interface CommandResult {
  name: string;
  command: string;
  status: 'passed' | 'failed' | 'skipped' | 'timed_out';
  exitCode: number | null;
  durationMs: number;
  output: string;
}

export interface InvestigationReport {
  generatedAt: string;
  repository: string;
  manifestPath: string;
  packageManager: string;
  finding: DependencyFinding;
  checks: ProjectCheck[];
  results: CommandResult[];
  externalWritesAllowed: false;
}

export interface RepositoryEvidence {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  manifestPath: string;
  manifestSha: string;
  manifestSize: number;
  archived: boolean;
}

export interface RegistryEvidence {
  packageName: string;
  targetVersion: string;
  latestVersion: string | null;
  description: string | null;
  repositoryUrl: string | null;
  homepage: string | null;
  nodeRequirement: string | null;
  peerDependencyCount: number;
}

export interface ReleaseNoteEvidence {
  title: string;
  tag: string;
  version: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
  prerelease: boolean;
}

export interface ReleaseEvidence {
  status: 'found' | 'not-found' | 'unavailable';
  sourceRepositoryUrl: string | null;
  notes: ReleaseNoteEvidence[];
  message: string;
}

export interface RemoteInvestigationReport extends InvestigationReport {
  mode: 'remote-readonly';
  source: RepositoryEvidence;
  registry: RegistryEvidence;
  releases: ReleaseEvidence;
}
