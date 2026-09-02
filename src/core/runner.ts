import { spawn } from 'node:child_process';
import type { CommandResult, ProjectCheck } from './types';

const MAX_OUTPUT = 12_000;

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

  const startedAt = Date.now();
  const [executable, ...args] = check.command.split(' ');

  return await new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, CI: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        name: check.name,
        command: check.command,
        status: signal === 'SIGTERM' ? 'timed_out' : exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        durationMs: Date.now() - startedAt,
        output: output.trim(),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name: check.name,
        command: check.command,
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: error.message,
      });
    });
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
