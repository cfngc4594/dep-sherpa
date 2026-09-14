#!/usr/bin/env node
import { runAction } from '../src/action/run';
import { prepareSourceCheckout } from '../src/action/source';
import { upgradeInIsolation } from '../src/core/upgrade';

/**
 * GitHub Action entry point. Invoked by action.yml inside the runner; every
 * input arrives as an environment variable and every result leaves through the
 * job summary, GITHUB_OUTPUT, report files, and at most one PR comment.
 */

try {
  const outcome = await runAction(process.env, {
    upgrade: upgradeInIsolation,
    prepareSource: prepareSourceCheckout,
    fetchImpl: fetch,
    log: (message) => console.log(message),
    warn: (message) => console.log(`::warning::${message.replace(/\r?\n/g, ' ')}`),
  });
  if (outcome.status === 'skipped') console.log(`::notice::DepSherpa skipped: ${outcome.reason.replace(/\r?\n/g, ' ')}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::DepSherpa could not complete: ${message.replace(/\r?\n/g, ' ')}`);
  process.exit(1);
}
