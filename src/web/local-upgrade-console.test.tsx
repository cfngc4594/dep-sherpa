import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sampleIsolatedUpgradeReport, sampleRepairAttempt } from '../harness/report-fixture';
import { interpolate } from '../i18n/locale';
import { messages, type MessageKey } from '../i18n/messages';
import type { Translate } from '../i18n/use-locale';
import { emptyLocalForm, LocalUpgradeView, type LocalUpgradeViewProps } from './local-upgrade-console';
import { ModeSwitch } from './mode-switch';
import type { LocalAvailability, LocalRunState } from './local-report';

const t: Translate = (key: MessageKey, values?: Record<string, string | number>) => interpolate(messages.en[key], values);

const enabled: LocalAvailability = {
  status: 'enabled',
  capabilities: {
    enabled: true,
    mode: 'local-harness',
    keepWorkspaceAllowed: false,
    projectRoot: '/Users/sample/dep-sherpa',
    proposalGenerator: 'none',
    policy: { maxFiles: 3, maxChangedLines: 12, allowedExtensions: ['.ts'], forbiddenPathPatterns: ['tests/'] },
    executionModel: { disposableClone: true, installScriptsAllowed: false, externalWritesAllowed: false, operatingSystemSandbox: false },
  },
};

function render(overrides: Partial<LocalUpgradeViewProps> = {}): string {
  const props: LocalUpgradeViewProps = {
    t,
    dateLocale: 'en-GB',
    availability: enabled,
    form: emptyLocalForm,
    run: { status: 'idle' },
    view: 'verdict',
    onFormChange: () => {},
    onSubmit: () => {},
    onReset: () => {},
    onViewChange: () => {},
    onCopy: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<LocalUpgradeView {...props} />);
}

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
}

function runButton(markup: string): string {
  return markup.match(/<button[^>]*data-testid="local-run"[^>]*>/)?.[0] ?? '';
}

describe('local upgrade mode in a public deployment', () => {
  it('shows the unavailability reason and keeps every execution control disabled', () => {
    const markup = render({ availability: { status: 'unavailable', reason: 'hosted_deployment' } });
    expect(markup).toContain(messages.en.localUnavailableTitle);
    expect(markup).toContain('hosted, read-only deployment');
    expect(runButton(markup)).toContain('disabled=""');
    const inputs = [...markup.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => input.includes('disabled=""'))).toBe(true);
    expect(markup).not.toContain('/api/local/upgrade');
  });

  it('explains every other gate reason and an unreachable harness without enabling the form', () => {
    for (const reason of ['production_environment', 'harness_disabled', 'non_loopback_request', 'cross_origin_request'] as const) {
      const markup = render({ availability: { status: 'unavailable', reason } });
      expect(markup).toContain(messages.en[`localUnavailable_${reason}`]);
      expect(runButton(markup)).toContain('disabled=""');
    }
    const unreachable = render({ availability: { status: 'unreachable' } });
    expect(unreachable).toContain(messages.en.localUnreachable);
    expect(runButton(unreachable)).toContain('disabled=""');
    const checking = render({ availability: { status: 'checking' } });
    expect(checking).toContain(messages.en.localChecking);
    expect(runButton(checking)).toContain('disabled=""');
  });

  it('marks the local mode as unavailable in the mode switch', () => {
    const markup = renderToStaticMarkup(<ModeSwitch t={t} mode="public" availability={{ status: 'unavailable', reason: 'hosted_deployment' }} onChange={() => {}} />);
    expect(markup).toContain(messages.en.modePublic);
    expect(markup).toContain(messages.en.modeLocalUpgrade);
    expect(markup).toContain(messages.en.modeLocalHintUnavailable);
    expect(markup).toContain('data-available="false"');
    const available = renderToStaticMarkup(<ModeSwitch t={t} mode="local" availability={enabled} onChange={() => {}} />);
    expect(available).toContain('data-available="true"');
    expect(available).toContain(messages.en.modeLocalHint);
  });
});

describe('local upgrade mode on the developer machine', () => {
  it('enables the form and states the trust boundary before anything runs', () => {
    const markup = render();
    expect(runButton(markup)).not.toContain('disabled');
    expect(markup).toContain(messages.en.localTrustNote);
    expect(markup).toContain(messages.en.localWaitingTitle);
    expect(markup).toContain(messages.en.useThisRepository);
    expect(markup).not.toContain(messages.en.toggleKeepWorkspace);
  });

  it('offers workspace retention only when the harness permits it', () => {
    const markup = render({ availability: { ...enabled, capabilities: { ...enabled.capabilities, keepWorkspaceAllowed: true } } });
    expect(markup).toContain(messages.en.toggleKeepWorkspace);
  });

  it('shows a running job with elapsed time and every stage in progress', () => {
    const run: LocalRunState = { status: 'running', startedAt: 0, elapsedMs: 65_000 };
    const markup = render({ run, form: { ...emptyLocalForm, packageName: 'zod', targetVersion: '4.1.5' } });
    expect(markup).toContain('Upgrading zod to 4.1.5 in isolation.');
    expect(markup).toContain('1m 5s');
    expect(markup).toContain(messages.en.runningUpgrade);
    expect((markup.match(/data-state="running"/g) ?? []).length).toBe(7);
  });

  it('renders the verdict, proposal source, stages, and the human decision gate from the report', () => {
    const report = sampleIsolatedUpgradeReport();
    const markup = render({ run: { status: 'ready', report, markdown: '# report' } });
    expect(markup).toContain(messages.en.verdictHeadline_repaired_ready_for_review);
    expect(markup).toContain('zod@4.1.5: repaired · ready for review.');
    expect(markup).toContain(messages.en.proposalSourceRecipe);
    expect(markup).toContain(messages.en.humanGateTitle);
    expect(markup).toContain('did not modify /Users/sample/projects/checkout');
    expect(markup).toContain(messages.en.verifiedDisclaimer);
    expect(markup).toContain('data-stage="candidate" data-state="failed"');
    expect(markup).toContain('data-stage="verification" data-state="passed"');
    expect(markup).toContain(messages.en.copyJson);
    expect(markup).toContain(messages.en.copyMarkdown);
  });

  it('never offers to apply, commit, push, or open a pull request', () => {
    const report = sampleIsolatedUpgradeReport();
    for (const view of ['verdict', 'checks', 'repair', 'diff'] as const) {
      const labels = buttonLabels(render({ run: { status: 'ready', report, markdown: '' }, view }));
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label).not.toMatch(/apply|commit|push|pull request|merge/i);
      }
    }
  });

  it('renders the comparison, diagnostics, repair provenance, and complete diff', () => {
    const report = sampleIsolatedUpgradeReport();
    const checks = render({ run: { status: 'ready', report, markdown: '' }, view: 'checks' });
    expect(checks).toContain(messages.en.checksTitle);
    expect(checks).toContain(messages.en.state_introduced_failure);
    expect(checks).toContain('The upgrade introduced a typecheck failure.');

    const repair = render({ run: { status: 'ready', report, markdown: '' }, view: 'repair' });
    expect(repair).toContain('zod-v4-errors-to-issues');
    expect(repair).toContain(messages.en.policyConclusion);
    expect(repair).toContain('src/validation.ts:1-6');
    expect(repair).toContain('Installed package manifest');
    expect(repair).toContain(messages.en.verificationTitle);

    const diff = render({ run: { status: 'ready', report, markdown: '' }, view: 'diff' });
    expect(diff).toContain('3 files changed in the clone');
    expect(diff).toContain('diff-remove');
    expect(diff).toContain('+  return error.issues.map((issue) =&gt; issue.message);');
    expect(diff).toContain(messages.en.diffNote);
  });

  it('labels a model proposal as a suggestion rather than a fact', () => {
    const report = sampleIsolatedUpgradeReport({
      repair: sampleRepairAttempt({
        proposal: { kind: 'agent', id: 'agent-monaco-1', summary: 'Rename the removed option.', evidence: [], edits: [] },
        proposalSource: 'agent',
        recipeId: null,
      }),
    });
    const markup = render({ run: { status: 'ready', report, markdown: '' } });
    expect(markup).toContain(messages.en.proposalSourceAgent);
    expect(markup).toContain('It is a suggestion, not a fact or a guarantee');
  });

  it('shows a policy rejection reason when the proposal was refused', () => {
    const report = sampleIsolatedUpgradeReport({
      verdict: 'needs_repair',
      repair: sampleRepairAttempt({ status: 'policy_rejected', rationale: 'The proposal would touch more than 3 source files.', verificationResults: [], patch: '' }),
    });
    const markup = render({ run: { status: 'ready', report, markdown: '' }, view: 'repair' });
    expect(markup).toContain(messages.en.repairStatus_policy_rejected);
    expect(markup).toContain('The proposal would touch more than 3 source files.');
    expect(markup).toContain('data-stage="policy" data-state="failed"');
  });

  it('shows harness errors without pretending a run happened', () => {
    const markup = render({ run: { status: 'error', error: { code: 'NOT_A_GIT_ROOT', message: '/tmp is not inside a Git repository.' } } });
    expect(markup).toContain(messages.en.localError_NOT_A_GIT_ROOT);
    expect(markup).toContain(messages.en.localHeadingError);
    expect(markup).not.toContain(messages.en.copyJson);
    const unavailable = render({ run: { status: 'error', error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', message: '', reason: 'production_environment' } } });
    expect(unavailable).toContain(messages.en.localUnavailable_production_environment);
  });
});
