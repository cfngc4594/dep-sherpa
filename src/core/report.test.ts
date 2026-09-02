import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from './report';
import type { InvestigationReport } from './types';

describe('report rendering', () => {
  it('keeps the human gate explicit', () => {
    const report: InvestigationReport = {
      generatedAt: '2026-09-02T00:00:00.000Z',
      repository: '@acme/checkout-ui',
      manifestPath: '/fixture/package.json',
      packageManager: 'pnpm',
      finding: {
        packageName: 'zod', section: 'dependencies', declaredRange: '^3.23.8',
        currentVersion: '3.23.8', targetVersion: '4.1.5', releaseType: 'major',
        risk: 'high', reasons: ['The target crosses a major-version boundary.'],
      },
      checks: [],
      results: [],
      externalWritesAllowed: false,
    };
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('External writes: **blocked**');
    expect(markdown).toContain('explicit human decision');
  });
});
