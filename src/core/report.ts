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
  const releaseEvidence = report.repair.releaseEvidence.length
    ? report.repair.releaseEvidence.map((item) => `- ${item}`).join('\n')
    : '- No package release or installed-version evidence was available to the proposal step.';
  const contextRead = report.repair.contextRead.length
    ? report.repair.contextRead.map((context) => `### \`${context.path}:${context.startLine}-${context.endLine}\`

Supporting diagnostic: ${context.diagnostic}

${context.content.split('\n').map((line) => `    ${line}`).join('\n')}`).join('\n\n')
    : 'No source excerpt was supplied to a proposal generator.';
  const proposal = report.repair.proposal
    ? `- Generator: **${report.repair.proposalSource === 'recipe' ? 'deterministic recipe' : 'model-generated candidate'}**
- Proposal ID: \`${report.repair.proposal.id}\`
- Summary: ${report.repair.proposal.summary}
- Suggested edits: ${report.repair.proposal.edits.length}

${report.repair.proposal.edits.map((edit, index) => `${index + 1}. \`${edit.path}\` — ${edit.rationale}\n   - Diagnostic: ${edit.diagnostic}`).join('\n')}`
    : report.repair.proposalSource === 'recipe'
      ? `- Generator: **deterministic recipe**\n- Recipe ID: \`${report.repair.recipeId}\`\n- The recipe matched, but policy rejected it before a complete proposal could be applied.`
      : '- Generator: **none**\n- No candidate proposal was produced.';
  const repairUnexpected = report.repair.unexpectedChanges.length
    ? report.repair.unexpectedChanges.map((entry) => `- \`${entry}\``).join('\n')
    : '- None detected.';
  const repairedSourceFiles = new Set(report.repair.proposal?.edits.map((edit) => edit.path) ?? []).size;

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
- Scope: ${repairedSourceFiles} source files, ${report.repair.changedLines} source lines; ${report.repair.changedFiles.length} files in the complete isolated diff
- Policy: at most ${report.repair.policy.maxFiles} source files and ${report.repair.policy.maxChangedLines} changed source lines
- Allowed extensions: ${report.repair.policy.allowedExtensions.map((extension) => `\`${extension}\``).join(', ')}
- Blocked path patterns: ${report.repair.policy.forbiddenPathPatterns.map((pattern) => `\`${pattern}\``).join(', ')}

${report.repair.rationale}

### Proposal provenance

${proposal}

Evidence cited by the proposal (not a guarantee):
${repairEvidence}

### Version and release evidence supplied

${releaseEvidence}

### Source context supplied

${contextRead}

| Repair verification | Result | Duration |
| --- | --- | ---: |
${repairChecks}

Unexpected changes during repair verification:
${repairUnexpected}

## Final isolated patch files

${changedFiles}

## Check side effects excluded from the patch

${sideEffects}

## Reviewable patch

\`\`\`diff
${patch}
\`\`\`

## Human gate

The candidate ran only in a disposable clone. Recipe output and model output are proposals, not facts or guarantees. This report does not modify the source repository, create a commit, push a branch, or open a pull request; explicit human approval is required. A human must decide whether to reject, revise, or separately apply the patch.
`;
}
