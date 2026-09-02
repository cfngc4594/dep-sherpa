import type { InvestigationReport, IsolatedUpgradeReport } from './types';

export function renderMarkdownReport(report: InvestigationReport): string {
  const { finding } = report;
  const checks = report.results
    .map((result) => `| ${result.name} | ${result.status} | \`${result.command}\` | ${result.durationMs} ms |`)
    .join('\n');

  return `# DepSherpa investigation: ${finding.packageName}

Generated: ${report.generatedAt}

## Decision packet

- Repository: \`${report.repository}\`
- Declared: \`${finding.declaredRange}\` in \`${finding.section}\`
- Target: \`${finding.targetVersion}\`
- Release type: ${finding.releaseType ?? 'unknown'}
- Risk: **${finding.risk}**
- DepSherpa external writes: **blocked**
- Repository scripts: **trusted local code; not OS-sandboxed**

${finding.reasons.map((reason) => `- ${reason}`).join('\n')}

## Checks

| Check | Result | Command | Duration |
| --- | --- | --- | ---: |
${checks}

## Human gate

This report does not modify a repository, push a branch, or create a pull request. An explicit human decision is required before authorizing any mutation.
`;
}

export function renderIsolatedUpgradeReport(report: IsolatedUpgradeReport): string {
  const comparisons = report.comparisons
    .map((comparison) => `| ${comparison.name} | ${comparison.baseline} | ${comparison.candidate} | ${comparison.state} |`)
    .join('\n');
  const suggestions = report.repairSuggestions.length
    ? report.repairSuggestions
        .map((suggestion) => `- **${suggestion.check}:** ${suggestion.summary} ${suggestion.nextAction}\n  - First diagnostic: ${suggestion.evidence}`)
        .join('\n')
    : '- No failing candidate check requires a repair suggestion.';
  const dirtySource = report.source.dirtyFilesIgnored.length
    ? report.source.dirtyFilesIgnored.map((file) => `  - \`${file}\``).join('\n')
    : '  - None';
  const changedFiles = report.changedFiles.length
    ? report.changedFiles.map((file) => `- \`${file}\``).join('\n')
    : '- No tracked manifest or npm lockfile change was produced.';
  const patch = report.patch || 'No patch was produced.';
  const sideEffects = report.unexpectedCandidateChanges.length
    ? report.unexpectedCandidateChanges.map((entry) => `- \`${entry}\``).join('\n')
    : '- None detected.';
  const repairChecks = report.repair.verificationResults.length
    ? report.repair.verificationResults
        .map((result) => `| ${result.name} | ${result.status} | ${result.durationMs} ms |`)
        .join('\n')
    : '| — | not run | — |';
  const repairEvidence = report.repair.evidence.length
    ? report.repair.evidence.map((item) => `- ${item}`).join('\n')
    : '- No source diagnostic was used.';

  return `# DepSherpa isolated upgrade: ${report.finding.packageName}

Generated: ${report.generatedAt}

## Decision packet

- Repository: \`${report.repository}\`
- Source commit: \`${report.source.gitHead}\`
- Declared: \`${report.finding.declaredRange}\` in \`${report.finding.section}\`
- Target: \`${report.finding.targetVersion}\`
- Risk: **${report.finding.risk}**
- Verdict: **${report.verdict}**
- Install lifecycle scripts: **blocked**
- DepSherpa external writes: **blocked**
- Repository scripts: **trusted local code; not OS-sandboxed**

Source changes intentionally excluded from the clone:
${dirtySource}

## Baseline vs candidate

| Check | Baseline | Candidate | Classification |
| --- | --- | --- | --- |
${comparisons}

## Repair triage

${suggestions}

## Bounded repair attempt

- Requested: **${report.repair.requested ? 'yes' : 'no'}**
- Status: **${report.repair.status}**
- Recipe: ${report.repair.recipeId ? `\`${report.repair.recipeId}\`` : 'none'}
- Scope: ${report.repair.changedFiles.length} files, ${report.repair.changedLines} source lines
- Policy: at most ${report.repair.policy.maxFiles} source files and ${report.repair.policy.maxChangedLines} changed source lines; tests, fixtures, migrations, and configuration remain blocked

${report.repair.rationale}

Evidence authorizing the repair:
${repairEvidence}

| Repair verification | Result | Duration |
| --- | --- | ---: |
${repairChecks}

## Upgrade-owned files

${changedFiles}

## Check side effects excluded from the patch

${sideEffects}

## Reviewable patch

\`\`\`diff
${patch}
\`\`\`

## Human gate

The candidate ran only in a disposable clone. This report does not modify the source repository, create a commit, push a branch, or open a pull request. Review and explicit human approval are still required before applying this patch anywhere.
`;
}
