import type { IsolatedUpgradeReport } from '../core/types.js';
import { renderInvestigationMermaid } from './pipeline-diagram.js';

/**
 * Compact pull-request comment. The complete Markdown report goes to the job
 * summary and the artifact; the comment stays under GitHub's size limit and
 * says plainly that it is a report, not an approval.
 */

export const commentMarker = '<!-- depsherpa:report -->';
const commentPatchLimit = 12_000;
const commentHardLimit = 60_000;

const verdictLabels: Record<IsolatedUpgradeReport['verdict'], string> = {
  ready_for_review: 'ready for review',
  repaired_ready_for_review: 'repaired · ready for review',
  needs_repair: 'needs repair',
  inconclusive: 'inconclusive',
  blocked: 'blocked',
};

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  return text.length > limit
    ? { text: `${text.slice(0, limit)}\n… (truncated)`, truncated: true }
    : { text, truncated: false };
}

function fence(content: string, language: string): string {
  const longestRun = Math.max(3, ...[...content.matchAll(/`{3,}/g)].map((match) => match[0].length + 1));
  const ticks = '`'.repeat(longestRun);
  return `${ticks}${language}\n${content}\n${ticks}`;
}

export function proposalSourceLabel(report: IsolatedUpgradeReport): string {
  const { repair } = report;
  if (repair.proposalSource === 'recipe' || repair.proposal?.kind === 'recipe')
    return `recipe \`${repair.recipeId ?? repair.proposal?.id ?? 'unknown'}\``;
  if (repair.proposalSource === 'agent' || repair.proposal?.kind === 'agent')
    return `model proposal \`${repair.proposal?.id ?? 'unknown'}\` (a suggestion, not a guarantee)`;
  return 'none';
}

export function renderPullRequestComment(report: IsolatedUpgradeReport, links: { runUrl: string | null }): string {
  const { finding, repair } = report;
  const from = finding.currentVersion ?? 'unresolved';
  const lines: string[] = [
    commentMarker,
    `### DepSherpa · \`${finding.packageName}\` ${from} → ${finding.targetVersion} — **${verdictLabels[report.verdict]}**`,
    '',
    `Ran in a disposable clone of \`${report.source.gitHead.slice(0, 7)}\` with npm lifecycle scripts blocked. Nothing was written to this repository, no commit or push was made, and this comment is a report, not an approval.`,
    '',
    renderInvestigationMermaid(report),
    '',
  ];

  if (report.preparation.status !== 'passed' || report.upgrade.status !== 'passed') {
    const failed = report.preparation.status !== 'passed' ? report.preparation : report.upgrade;
    lines.push(
      `**${failed.name}** ${failed.status} (\`${failed.command}\`)`,
      '',
      fence(truncate(failed.output, 2_000).text, 'text'),
      '',
    );
  }

  if (report.comparisons.length) {
    lines.push('| Check | Baseline | Candidate | Classification |', '| --- | --- | --- | --- |');
    for (const comparison of report.comparisons) {
      lines.push(
        `| ${comparison.name} | ${comparison.baseline} | ${comparison.candidate} | ${comparison.state.replace(/_/g, ' ')} |`,
      );
    }
    lines.push('');
  }

  if (report.repairSuggestions.length) {
    lines.push('**Diagnostics**', '');
    for (const suggestion of report.repairSuggestions) {
      lines.push(`- \`${suggestion.check}\` (${suggestion.classification.replace(/_/g, ' ')}): ${suggestion.evidence}`);
    }
    lines.push('');
  }

  const repairLine = repair.requested
    ? `**Repair:** ${repair.status.replace(/_/g, ' ')} · source: ${proposalSourceLabel(report)}${repair.changedLines ? ` · ${repair.changedLines} source line(s)` : ''}`
    : '**Repair:** not requested';
  lines.push(repairLine, '', `> ${repair.rationale}`, '');
  if (repair.proposalSource === 'agent' || repair.proposal?.kind === 'agent') {
    lines.push(
      '> The proposal came from a model. `verified` only means the observed checks passed inside the clone; it is not a correctness guarantee.',
      '',
    );
  }

  if (report.unexpectedCandidateChanges.length || repair.unexpectedChanges.length) {
    lines.push('**Unexpected changes**', '');
    for (const entry of [...report.unexpectedCandidateChanges, ...repair.unexpectedChanges])
      lines.push(`- \`${entry}\``);
    lines.push('');
  }

  if (report.patch) {
    const patch = truncate(report.patch, commentPatchLimit);
    lines.push(
      `<details><summary>Candidate patch (${report.changedFiles.length} file${report.changedFiles.length === 1 ? '' : 's'}${patch.truncated ? ', truncated here; complete in the artifact' : ''})</summary>`,
      '',
      fence(patch.text, 'diff'),
      '',
      '</details>',
      '',
    );
  } else {
    lines.push('No tracked manifest, lockfile, or source change was produced.', '');
  }

  const fullReport = links.runUrl
    ? `Full report: [job summary and artifact](${links.runUrl}).`
    : 'Full report: see the job summary and the `depsherpa-report` artifact.';
  lines.push(`**Human decision required.** Reject, revise, or apply the reviewed patch yourself. ${fullReport}`);

  const body = lines.join('\n');
  return body.length > commentHardLimit
    ? `${body.slice(0, commentHardLimit)}\n… (comment truncated; see the artifact)`
    : body;
}
