import type { IsolatedUpgradeReport } from '../core/types.js';

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function stageLabel(name: string, ok: boolean): string {
  return escapeMermaidLabel(`${name} ${ok ? 'ok' : 'failed'}`);
}

function repairStageLabel(report: IsolatedUpgradeReport): string {
  if (!report.repair.requested) return 'repair skipped';
  return report.repair.status.replace(/_/g, ' ');
}

/** Compact Mermaid diagram for pull-request comments (GitHub renders ```mermaid fences). */
export function renderInvestigationMermaid(report: IsolatedUpgradeReport): string {
  const prepOk = report.preparation.status === 'passed';
  const upgradeOk = report.upgrade.status === 'passed';
  const introduced = report.comparisons.some((comparison) => comparison.state === 'introduced_failure');
  const compareLabel = introduced ? 'checks introduced failure' : 'checks compared';
  const verdict = report.verdict.replace(/_/g, ' ');

  return [
    '```mermaid',
    'flowchart LR',
    `  prep["${stageLabel('prepare', prepOk)}"] --> upg["${stageLabel('upgrade', upgradeOk)}"]`,
    `  upg --> cmp["${escapeMermaidLabel(compareLabel)}"]`,
    `  cmp --> rep["${escapeMermaidLabel(repairStageLabel(report))}"]`,
    `  rep --> out["${escapeMermaidLabel(`verdict ${verdict}`)}"]`,
    '```',
  ].join('\n');
}
