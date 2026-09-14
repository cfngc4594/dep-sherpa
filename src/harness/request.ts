import semver from 'semver';
import type { LocalApiError, LocalInspectRequestBody, LocalUpgradeRequestBody } from './contracts';

/**
 * Strict request parsing for the local API. The browser may only name a local
 * repository path, an npm package, an exact target version, and two booleans.
 * Commands, script names, environment variables, and executable paths have no
 * field to arrive through, and unknown fields are rejected rather than ignored.
 */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LocalApiError };

const upgradeFields = new Set(['repoPath', 'packageName', 'targetVersion', 'attemptRepair', 'keepWorkspace']);
const inspectFields = new Set(['repoPath', 'packageName', 'targetVersion']);
const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

const maxRepoPathLength = 1_024;
const maxPackageNameLength = 214;
const maxVersionLength = 64;

function invalid(message: string): ParseResult<never> {
  return { ok: false, error: { code: 'INVALID_INPUT', message } };
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function validateRepoPath(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return invalid('repoPath must be an absolute path string.');
  const repoPath = value.trim();
  if (!repoPath || repoPath.length > maxRepoPathLength) return invalid('repoPath must be a non-empty absolute path.');
  if (repoPath.includes('\0') || /[\r\n]/.test(repoPath)) return invalid('repoPath contains characters that are not allowed.');
  if (!isAbsolutePath(repoPath)) return invalid('repoPath must be an absolute path to the Git root of a repository.');
  if (repoPath.split(/[\\/]/).includes('..')) return invalid('repoPath must not contain parent-directory segments.');
  return { ok: true, value: repoPath };
}

export function validatePackageName(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return invalid('packageName must be a string.');
  const packageName = value.trim();
  if (!packageName || packageName.length > maxPackageNameLength || !npmPackageName.test(packageName)) {
    return invalid('packageName must be a valid lowercase npm package name.');
  }
  return { ok: true, value: packageName };
}

export function validateTargetVersion(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return invalid('targetVersion must be a string.');
  const targetVersion = value.trim();
  if (!targetVersion || targetVersion.length > maxVersionLength) return invalid('targetVersion must be an exact semantic version.');
  const exact = semver.valid(targetVersion, { loose: false });
  if (!exact || /\s/.test(targetVersion)) return invalid('targetVersion must be an exact semantic version such as 4.1.5; ranges and dist-tags are not accepted.');
  return { ok: true, value: exact };
}

function validateBoolean(value: unknown, field: string, fallback: boolean | null): ParseResult<boolean> {
  if (value === undefined) {
    return fallback === null ? invalid(`${field} must be provided as a boolean.`) : { ok: true, value: fallback };
  }
  if (typeof value !== 'boolean') return invalid(`${field} must be a boolean.`);
  return { ok: true, value };
}

function objectBody(body: unknown, allowedFields: Set<string>): ParseResult<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Send a JSON object.');
  const record = body as Record<string, unknown>;
  const unknownField = Object.keys(record).find((key) => !allowedFields.has(key));
  if (unknownField !== undefined) {
    return invalid(`Unsupported field "${unknownField}". The local API accepts only ${[...allowedFields].join(', ')}.`);
  }
  return { ok: true, value: record };
}

export function parseLocalUpgradeRequest(
  body: unknown,
  options: { keepWorkspaceAllowed: boolean },
): ParseResult<Required<LocalUpgradeRequestBody>> {
  const record = objectBody(body, upgradeFields);
  if (!record.ok) return record;
  const repoPath = validateRepoPath(record.value.repoPath);
  if (!repoPath.ok) return repoPath;
  const packageName = validatePackageName(record.value.packageName);
  if (!packageName.ok) return packageName;
  const targetVersion = validateTargetVersion(record.value.targetVersion);
  if (!targetVersion.ok) return targetVersion;
  const attemptRepair = validateBoolean(record.value.attemptRepair, 'attemptRepair', false);
  if (!attemptRepair.ok) return attemptRepair;
  const keepWorkspace = validateBoolean(record.value.keepWorkspace, 'keepWorkspace', false);
  if (!keepWorkspace.ok) return keepWorkspace;
  if (keepWorkspace.value && !options.keepWorkspaceAllowed) {
    return {
      ok: false,
      error: {
        code: 'KEEP_WORKSPACE_NOT_ENABLED',
        message: 'Retaining the disposable workspace requires starting the harness with DEPSHERPA_KEEP_WORKSPACE=1.',
      },
    };
  }
  return {
    ok: true,
    value: {
      repoPath: repoPath.value,
      packageName: packageName.value,
      targetVersion: targetVersion.value,
      attemptRepair: attemptRepair.value,
      keepWorkspace: keepWorkspace.value,
    },
  };
}

export function parseLocalInspectRequest(body: unknown): ParseResult<LocalInspectRequestBody> {
  const record = objectBody(body, inspectFields);
  if (!record.ok) return record;
  const repoPath = validateRepoPath(record.value.repoPath);
  if (!repoPath.ok) return repoPath;
  const packageName = validatePackageName(record.value.packageName);
  if (!packageName.ok) return packageName;
  const targetVersion = validateTargetVersion(record.value.targetVersion);
  if (!targetVersion.ok) return targetVersion;
  return { ok: true, value: { repoPath: repoPath.value, packageName: packageName.value, targetVersion: targetVersion.value } };
}
