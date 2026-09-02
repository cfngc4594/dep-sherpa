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
