import type { InvestigationReport } from './types';

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
