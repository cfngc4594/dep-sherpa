import { describe, expect, it } from '@jest/globals';
import { runCommand } from '../../src/core/runner.js';

describe('bounded command runner', () => {
  it('executes argument arrays without a shell', async () => {
    const result = await runCommand({
      name: 'node',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'literal;not-a-shell-command'],
      cwd: process.cwd(),
    });
    expect(result.status).toBe('passed');
    expect(result.output).toBe('literal;not-a-shell-command');
  });

  it('marks a process as timed out', async () => {
    const result = await runCommand({
      name: 'slow',
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      timeoutMs: 30,
    });
    expect(result.status).toBe('timed_out');
  });
});
