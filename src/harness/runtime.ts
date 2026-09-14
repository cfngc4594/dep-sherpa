import { resolveModelConfig } from '../agent/openai';
import { investigate } from '../core/investigate';
import { upgradeInIsolation } from '../core/upgrade';
import { createLocalApiHandler, type LocalApiDependencies, type LocalApiHandler } from './api';
import { detectExecutionContext, evaluateLocalExecutionGate } from './gate';
import { validateRepositoryPath } from './repository';

/**
 * Wires the local API to the same deterministic core the CLI uses. This is the
 * only place where the harness references `upgradeInIsolation` and
 * `investigate`; hosted route handlers never import this module.
 */

export interface LocalHarnessRuntimeOptions {
  env?: Record<string, string | undefined>;
  projectRoot?: string | null;
  overrides?: Partial<LocalApiDependencies>;
}

const enabledFlagValues = new Set(['1', 'true', 'on', 'yes']);

export function isKeepWorkspaceAllowed(env: Record<string, string | undefined>): boolean {
  const flag = env.DEPSHERPA_KEEP_WORKSPACE;
  return flag !== undefined && enabledFlagValues.has(flag.trim().toLowerCase());
}

export function createLocalHarnessDependencies(options: LocalHarnessRuntimeOptions = {}): LocalApiDependencies {
  const env = options.env ?? process.env;
  return {
    gate: () => evaluateLocalExecutionGate(detectExecutionContext({ harnessAttached: true, env })),
    upgrade: upgradeInIsolation,
    inspect: investigate,
    validateRepository: validateRepositoryPath,
    keepWorkspaceAllowed: isKeepWorkspaceAllowed(env),
    projectRoot: options.projectRoot ?? null,
    modelProvider: resolveModelConfig(env).provider,
    ...options.overrides,
  };
}

export function createLocalHarnessHandler(options: LocalHarnessRuntimeOptions = {}): LocalApiHandler {
  return createLocalApiHandler(createLocalHarnessDependencies(options));
}
