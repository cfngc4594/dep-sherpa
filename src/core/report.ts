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
- External writes: **blocked**

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
- External writes: **blocked**

Source changes intentionally excluded from the clone:
${dirtySource}

## Baseline vs candidate

| Check | Baseline | Candidate | Classification |
| --- | --- | --- | --- |
${comparisons}

## Repair triage

${suggestions}

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
