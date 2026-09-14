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

export type CheckComparisonState =
  | 'passed'
  | 'introduced_failure'
  | 'pre_existing_failure'
  | 'resolved'
  | 'not_run';

export interface CheckComparison {
  name: string;
  baseline: CommandResult['status'];
  candidate: CommandResult['status'];
  state: CheckComparisonState;
}

export interface RepairSuggestion {
  check: string;
  classification: CheckComparisonState;
  summary: string;
  nextAction: string;
  evidence: string;
}

export interface RepairPolicyLimits {
  maxFiles: number;
  maxChangedLines: number;
  allowedExtensions: string[];
  forbiddenPathPatterns: string[];
}

/** A model or recipe may suggest this object, but it has no authority to apply it. */
export interface RepairEdit {
  path: string;
  expectedText: string;
  replacement: string;
  rationale: string;
  diagnostic: string;
}

export interface RepairProposal {
  kind: 'recipe' | 'agent';
  id: string;
  summary: string;
  evidence: string[];
  edits: RepairEdit[];
}

export interface RepairContextExcerpt {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  diagnostic: string;
}

export interface RepairInvestigationContext {
  finding: DependencyFinding;
  diagnostics: string[];
  sources: RepairContextExcerpt[];
  manifest: PackageManifest;
  checks: ProjectCheck[];
  releaseEvidence: string[];
  policy: RepairPolicyLimits;
}

export type RepairProposalGeneration =
  | { status: 'generated'; proposal: RepairProposal }
  | { status: 'no_proposal'; reason: string }
  | { status: 'unavailable'; reason: string };

export type RepairProposalGenerator = (
  context: RepairInvestigationContext,
) => Promise<RepairProposalGeneration>;

export interface RepairAttempt {
  requested: boolean;
  status:
    | 'not_requested'
    | 'not_needed'
    | 'unsupported'
    | 'agent_unavailable'
    | 'policy_rejected'
    | 'verified'
    | 'failed_verification';
  recipeId: string | null;
  proposal: RepairProposal | null;
  proposalSource: 'recipe' | 'agent' | null;
  contextRead: RepairContextExcerpt[];
  releaseEvidence: string[];
  rationale: string;
  evidence: string[];
  changedFiles: string[];
  changedLines: number;
  patch: string;
  verificationResults: CommandResult[];
  unexpectedChanges: string[];
  policy: RepairPolicyLimits;
}

export interface IsolatedUpgradeReport extends InvestigationReport {
  mode: 'isolated-local';
  source: {
    path: string;
    gitHead: string;
    dirtyFilesIgnored: string[];
  };
  workspace: {
    disposable: true;
    retained: boolean;
    path: string | null;
  };
  preparation: CommandResult;
  upgrade: CommandResult;
  baselineResults: CommandResult[];
  baselineSideEffects: string[];
  candidateResults: CommandResult[];
  workspaceChangesAfterChecks: string[];
  unexpectedCandidateChanges: string[];
  comparisons: CheckComparison[];
  upgradeChangedFiles: string[];
  upgradePatch: string;
  changedFiles: string[];
  patch: string;
  verdict: 'ready_for_review' | 'repaired_ready_for_review' | 'needs_repair' | 'inconclusive' | 'blocked';
  repairSuggestions: RepairSuggestion[];
  repair: RepairAttempt;
  installScriptsAllowed: false;
}
