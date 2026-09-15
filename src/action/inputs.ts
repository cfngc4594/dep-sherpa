import semver from 'semver';
import type { IsolatedUpgradeReport } from '../core/types.js';

/** Verdicts that may appear in `fail-on` (excludes `skipped`, which never completes a report). */
export const FAIL_ON_VERDICTS = [
  'ready_for_review',
  'repaired_ready_for_review',
  'needs_repair',
  'inconclusive',
  'blocked',
] as const satisfies readonly IsolatedUpgradeReport['verdict'][];

export type FailOnVerdict = (typeof FAIL_ON_VERDICTS)[number];

/**
 * Inputs the GitHub Action accepts, read through `@actions/core`'s `getInput`.
 * Nothing else is read from the workflow, so a workflow cannot hand DepSherpa a
 * command, a script name, or an executable.
 */
export interface ActionInputs {
  packageName: string | null;
  targetVersion: string | null;
  attemptRepair: boolean;
  comment: boolean;
  uploadArtifact: boolean;
  /** Directory (relative to the workspace) that receives report.json, report.md, and candidate.patch. */
  outputDir: string;
  /** Model settings; empty strings mean "not provided". */
  model: string | null;
  openaiBaseUrl: string | null;
  openaiApiKey: string | null;
  githubToken: string | null;
  /** When the report verdict is listed here, the workflow step fails after outputs are set. */
  failOn: ReadonlySet<FailOnVerdict>;
}

export type InputValidation = { ok: true; value: string } | { ok: false; message: string };

const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Only a valid lowercase npm package name may reach the core. */
export function validatePackageName(value: string): InputValidation {
  const packageName = value.trim();
  if (!packageName || packageName.length > 214 || !npmPackageName.test(packageName)) {
    return { ok: false, message: 'package must be a valid lowercase npm package name.' };
  }
  return { ok: true, value: packageName };
}

/** Only an exact semantic version may reach the core; ranges and dist-tags are rejected. */
export function validateTargetVersion(value: string): InputValidation {
  const targetVersion = value.trim();
  const exact =
    targetVersion.length <= 64 && !/\s/.test(targetVersion) ? semver.valid(targetVersion, { loose: false }) : null;
  if (!exact) {
    return {
      ok: false,
      message: 'version must be an exact semantic version such as 4.1.5; ranges and dist-tags are not accepted.',
    };
  }
  return { ok: true, value: exact };
}

export function parseBooleanInput(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Expected a boolean input but received "${value}".`);
}

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Comma- or whitespace-separated verdict names; empty means report-only (never fail on verdict). */
export function parseFailOn(value: string | undefined): ReadonlySet<FailOnVerdict> {
  const trimmed = value?.trim();
  if (!trimmed) return new Set();
  const allowed = new Set<string>(FAIL_ON_VERDICTS);
  const result = new Set<FailOnVerdict>();
  for (const part of trimmed.split(/[,\s]+/)) {
    const token = part.trim();
    if (!token) continue;
    if (!allowed.has(token)) {
      throw new Error(`fail-on contains unknown verdict "${token}"; expected one of: ${FAIL_ON_VERDICTS.join(', ')}.`);
    }
    result.add(token as FailOnVerdict);
  }
  return result;
}

export type InputReader = (name: string) => string;

export function readActionInputs(getInput: InputReader): ActionInputs {
  const outputDir = optionalText(getInput('report-dir')) ?? 'depsherpa-report';
  if (outputDir.startsWith('/') || /^[A-Za-z]:/.test(outputDir) || outputDir.split(/[\\/]/).includes('..')) {
    throw new Error('report-dir must be a relative path inside the workspace.');
  }
  return {
    packageName: optionalText(getInput('package')),
    targetVersion: optionalText(getInput('version')),
    attemptRepair: parseBooleanInput(getInput('attempt-repair'), true),
    comment: parseBooleanInput(getInput('comment'), true),
    uploadArtifact: parseBooleanInput(getInput('upload-artifact'), true),
    outputDir,
    model: optionalText(getInput('model')),
    openaiBaseUrl: optionalText(getInput('openai-base-url')),
    openaiApiKey: optionalText(getInput('openai-api-key')),
    githubToken: optionalText(getInput('github-token')),
    failOn: parseFailOn(getInput('fail-on')),
  };
}

/**
 * Environment handed to the model layer: workflow inputs win over ambient
 * variables so a workflow can point at any OpenAI-compatible endpoint without
 * touching the runner environment.
 */
export function modelEnvironment(
  inputs: ActionInputs,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    ...(inputs.openaiApiKey ? { OPENAI_API_KEY: inputs.openaiApiKey } : {}),
    ...(inputs.openaiBaseUrl ? { OPENAI_BASE_URL: inputs.openaiBaseUrl } : {}),
    ...(inputs.model ? { DEPSHERPA_MODEL: inputs.model } : {}),
  };
}
