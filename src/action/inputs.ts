/**
 * Inputs the GitHub Action accepts. `action.yml` maps each `with:` input to one
 * of these environment variables; nothing else is read from the workflow, so a
 * workflow cannot hand DepSherpa a command, a script name, or an executable.
 */
export interface ActionInputs {
  packageName: string | null;
  targetVersion: string | null;
  attemptRepair: boolean;
  comment: boolean;
  /** Directory (relative to the workspace) that receives report.json, report.md, and candidate.patch. */
  outputDir: string;
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

export function readActionInputs(env: Record<string, string | undefined>): ActionInputs {
  const outputDir = optionalText(env.DEPSHERPA_OUTPUT_DIR) ?? 'depsherpa-report';
  if (outputDir.startsWith('/') || outputDir.split(/[\\/]/).includes('..')) {
    throw new Error('DEPSHERPA_OUTPUT_DIR must be a relative path inside the workspace.');
  }
  return {
    packageName: optionalText(env.DEPSHERPA_PACKAGE),
    targetVersion: optionalText(env.DEPSHERPA_TARGET_VERSION),
    attemptRepair: parseBooleanInput(env.DEPSHERPA_ATTEMPT_REPAIR, true),
    comment: parseBooleanInput(env.DEPSHERPA_COMMENT, true),
    outputDir,
  };
}
