#!/usr/bin/env node
import { investigateWithStrands } from '../src/agent/strands';
import { investigate } from '../src/core/investigate';
import { renderIsolatedUpgradeReport, renderMarkdownReport } from '../src/core/report';
import { upgradeInIsolation } from '../src/core/upgrade';

function usage(): never {
  console.error(`Usage:
  npm run depsherpa -- inspect <repo> <package> <target> [--run-checks] [--json]
  npm run depsherpa -- upgrade <repo> <package> <target> [--attempt-repair] [--keep-workspace] [--json]
  npm run depsherpa -- agent   <repo> <package> <target>

Examples:
  npm run depsherpa -- inspect fixtures/checkout-ui zod 4.1.5
  npm run depsherpa -- inspect . next 17.0.0 --run-checks
  npm run depsherpa -- upgrade /path/to/npm-repo zod 4.1.5 --attempt-repair
  npm run depsherpa -- agent . zod 4.1.5`);
  process.exit(1);
}

const [command, repoPath, packageName, targetVersion, ...flags] = process.argv.slice(2);
if (!command || !repoPath || !packageName || !targetVersion) usage();

if (command === 'inspect') {
  const report = await investigate({
    repoPath,
    packageName,
    targetVersion,
    runProjectChecks: flags.includes('--run-checks'),
  });
  console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : renderMarkdownReport(report));
} else if (command === 'upgrade') {
  const report = await upgradeInIsolation({
    repoPath,
    packageName,
    targetVersion,
    keepWorkspace: flags.includes('--keep-workspace'),
    attemptRepair: flags.includes('--attempt-repair'),
  });
  console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : renderIsolatedUpgradeReport(report));
} else if (command === 'agent') {
  console.log(await investigateWithStrands(repoPath, packageName, targetVersion));
} else {
  usage();
}
