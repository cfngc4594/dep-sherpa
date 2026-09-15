import type { IsolatedUpgradeReport } from '../core/types.js';

/** GitHub Actions workflow annotation (file paths must be relative to the repository root). */
export interface WorkflowDiagnosticAnnotation {
  file: string;
  startLine: number;
  endLine: number;
  message: string;
}

const sourcePathPattern = /([A-Za-z0-9_./@-]+\.(?:tsx?|jsx?))(?:\((\d+),\d+\)|:(\d+):\d+)/;

function normalizeRepoRelativePath(value: string): string | null {
  let normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (pathLooksAbsolute(normalized)) return null;
  if (!normalized || normalized.split('/').includes('..')) return null;
  return normalized;
}

function pathLooksAbsolute(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:/.test(value);
}

function locationFromText(text: string): { file: string; line: number } | null {
  const match = text.match(sourcePathPattern);
  if (!match) return null;
  const file = normalizeRepoRelativePath(match[1].trim());
  const line = Number(match[2] ?? match[3]);
  if (!file || !Number.isInteger(line) || line < 1) return null;
  return { file, line };
}

const maxAnnotations = 10;
const maxMessageLength = 240;

/**
 * Turns bounded repair context and check diagnostics into workflow annotations.
 * Absolute clone paths are skipped because GitHub only accepts repository-relative files.
 */
export function workflowDiagnosticAnnotations(report: IsolatedUpgradeReport): WorkflowDiagnosticAnnotation[] {
  const seen = new Set<string>();
  const annotations: WorkflowDiagnosticAnnotation[] = [];

  const push = (file: string, line: number, message: string) => {
    const normalized = normalizeRepoRelativePath(file);
    if (!normalized || !Number.isInteger(line) || line < 1) return;
    const key = `${normalized}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    annotations.push({
      file: normalized,
      startLine: line,
      endLine: line,
      message: message.trim().slice(0, maxMessageLength),
    });
  };

  for (const excerpt of report.repair.contextRead) {
    const located = locationFromText(excerpt.diagnostic);
    push(located?.file ?? excerpt.path, located?.line ?? excerpt.startLine, excerpt.diagnostic);
    if (annotations.length >= maxAnnotations) return annotations;
  }

  for (const suggestion of report.repairSuggestions) {
    const located = locationFromText(suggestion.evidence);
    if (located) push(located.file, located.line, suggestion.evidence);
    if (annotations.length >= maxAnnotations) return annotations;
  }

  for (const edit of report.repair.proposal?.edits ?? []) {
    const located = locationFromText(edit.diagnostic);
    if (located) push(located.file, located.line, edit.diagnostic);
    if (annotations.length >= maxAnnotations) return annotations;
  }

  return annotations;
}
