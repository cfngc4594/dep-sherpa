import { spawn } from 'node:child_process';
import type { CommandResult, ProjectCheck } from './types';

const MAX_OUTPUT = 12_000;

export interface CommandSpec {
  name: string;
  executable: string;
  args: string[];
  cwd: string;
  displayCommand?: string;
  timeoutMs?: number;
  maxOutputBytes?: number | null;
}

function displayCommand(executable: string, args: string[]): string {
  return [executable, ...args]
    .map((part) => /^[A-Za-z0-9_./@:=+-]+$/.test(part) ? part : JSON.stringify(part))
    .join(' ');
}

export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const startedAt = Date.now();
  const command = spec.displayCommand ?? displayCommand(spec.executable, spec.args);
  const timeoutMs = spec.timeoutMs ?? 120_000;

  return await new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env, CI: '1', PWD: spec.cwd };
    delete childEnvironment['OLDPWD'];
    delete childEnvironment['INIT_CWD'];
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: childEnvironment,
      detached,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const append = (chunk: Buffer) => {
      const next = `${output}${chunk.toString()}`;
      output = spec.maxOutputBytes === null ? next : next.slice(-(spec.maxOutputBytes ?? MAX_OUTPUT));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      forceKillTimer = setTimeout(() => {
        try {
          if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, 5_000);
    }, timeoutMs);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        name: spec.name,
        command,
        status: timedOut ? 'timed_out' : exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        durationMs: Date.now() - startedAt,
        output: output.trim(),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        name: spec.name,
        command,
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: error.message,
      });
    });
  });
}

export async function runCheck(
  check: ProjectCheck,
  cwd: string,
  timeoutMs = 120_000,
): Promise<CommandResult> {
  if (!check.available) {
    return {
      name: check.name,
      command: check.command,
      status: 'skipped',
      exitCode: null,
      durationMs: 0,
      output: `No ${check.name} script is declared.`,
    };
  }

  const [executable, ...args] = check.command.split(' ');
  return await runCommand({
    name: check.name,
    executable,
    args,
    cwd,
    displayCommand: check.command,
    timeoutMs,
  });
}

export async function runChecks(
  checks: ProjectCheck[],
  cwd: string,
  timeoutMs?: number,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const check of checks) results.push(await runCheck(check, cwd, timeoutMs));
  return results;
}
