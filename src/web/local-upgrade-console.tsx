'use client';

import {
  ArrowRight,
  Check,
  CircleDashed,
  Copy,
  FileCode,
  FileDiff,
  FolderGit2,
  GitBranch,
  ListChecks,
  PackageSearch,
  RotateCcw,
  Scale,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { CommandResult, IsolatedUpgradeReport } from '../core/types';
import type { LocalApiError, LocalApiErrorCode } from '../harness/contracts';
import type { MessageKey } from '../i18n/messages';
import type { Translate } from '../i18n/use-locale';
import { LocalApiRequestError, streamLocalUpgrade } from './local-client';
import {
  canRunLocally,
  classifyDiffLine,
  deriveLocalStages,
  formatDuration,
  formatElapsedParts,
  proposalSource,
  type LocalAvailability,
  type LocalRunState,
  type LocalStageState,
} from './local-report';

export type LocalView = 'verdict' | 'checks' | 'repair' | 'diff';
export const localViews: LocalView[] = ['verdict', 'checks', 'repair', 'diff'];

export interface LocalUpgradeForm {
  repoPath: string;
  packageName: string;
  targetVersion: string;
  attemptRepair: boolean;
  keepWorkspace: boolean;
}

export const emptyLocalForm: LocalUpgradeForm = {
  repoPath: '',
  packageName: '',
  targetVersion: '',
  attemptRepair: true,
  keepWorkspace: false,
};

export interface LocalUpgradeViewProps {
  t: Translate;
  dateLocale: string;
  availability: LocalAvailability;
  form: LocalUpgradeForm;
  run: LocalRunState;
  view: LocalView;
  onFormChange: (form: LocalUpgradeForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onViewChange: (view: LocalView) => void;
  onCopy: (text: string, confirmation: string) => void;
}

function LineMark({ state }: { state: LocalStageState }) {
  const done = state === 'passed' || state === 'skipped' || state === 'attention' || state === 'failed';
  return <span className={`line-mark ${done ? 'line-mark--done' : ''} ${state === 'running' ? 'line-mark--active' : ''} ${state === 'failed' ? 'line-mark--failed' : ''}`} aria-hidden="true"><span /></span>;
}

function packageInitial(packageName: string): string {
  return packageName.split('/').at(-1)?.charAt(0).toUpperCase() || 'D';
}

function riskLabel(risk: string, t: Translate): string {
  if (risk === 'low') return t('riskLow');
  if (risk === 'medium') return t('riskMedium');
  if (risk === 'high') return t('riskHigh');
  return t('riskUnknown');
}

function resultLabel(status: CommandResult['status'], t: Translate): string {
  return t(`result_${status}`);
}

const localErrorKeys: Partial<Record<LocalApiErrorCode, MessageKey>> = {
  LOCAL_EXECUTION_UNAVAILABLE: 'localError_LOCAL_EXECUTION_UNAVAILABLE',
  INVALID_INPUT: 'localError_INVALID_INPUT',
  REPOSITORY_NOT_FOUND: 'localError_REPOSITORY_NOT_FOUND',
  NOT_A_GIT_ROOT: 'localError_NOT_A_GIT_ROOT',
  KEEP_WORKSPACE_NOT_ENABLED: 'localError_KEEP_WORKSPACE_NOT_ENABLED',
  RUN_IN_PROGRESS: 'localError_RUN_IN_PROGRESS',
  UNSUPPORTED_MEDIA_TYPE: 'localError_UNSUPPORTED_MEDIA_TYPE',
  PAYLOAD_TOO_LARGE: 'localError_PAYLOAD_TOO_LARGE',
};

export function localErrorMessage(error: LocalApiError, t: Translate): string {
  if (error.code === 'LOCAL_EXECUTION_UNAVAILABLE' && error.reason) return t(`localUnavailable_${error.reason}`);
  if (error.code === 'RUN_FAILED') return t('localError_RUN_FAILED', { message: error.message });
  const key = localErrorKeys[error.code];
  return key ? t(key) : t('localErrorFallback');
}

function elapsedLabel(elapsedMs: number, t: Translate): string {
  return t('elapsedFormat', formatElapsedParts(elapsedMs));
}

function StatusChip({ status, t }: { status: CommandResult['status']; t: Translate }) {
  return <span className={`status-chip status-chip--${status}`}>{status === 'passed' ? <Check size={12} /> : status === 'skipped' ? <span aria-hidden="true">—</span> : <TriangleAlert size={12} />}{resultLabel(status, t)}</span>;
}

function ResultsTable({ results, t }: { results: CommandResult[]; t: Translate }) {
  return (
    <table className="ledger-table">
      <thead><tr><th>{t('colCheck')}</th><th>{t('colResult')}</th><th>{t('colDuration')}</th></tr></thead>
      <tbody>
        {results.map((result) => (
          <tr key={result.name}><td><code>{result.name}</code></td><td><StatusChip status={result.status} t={t} /></td><td>{formatDuration(result.durationMs)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function VerdictPanel({ report, t, dateLocale }: { report: IsolatedUpgradeReport; t: Translate; dateLocale: string }) {
  const source = proposalSource(report.repair);
  const sourceLabel = source === 'recipe' ? t('proposalSourceRecipe') : source === 'agent' ? t('proposalSourceAgent') : t('proposalSourceNone');
  return (
    <div className="brief-view">
      <div className="margin-note">{`HEAD ${report.source.gitHead.slice(0, 7).toUpperCase()}`}<br />{new Intl.DateTimeFormat(dateLocale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(report.generatedAt))}</div>
      <h3>{t(`verdictHeadline_${report.verdict}`)}</h3>
      <p>{report.repair.rationale}</p>
      <dl className="risk-ledger">
        <div><dt>{t('ledgerVerdict')}</dt><dd><span className={`verdict-mark verdict-mark--${report.verdict}`}>{t(`verdict_${report.verdict}`)}</span></dd></div>
        <div><dt>{t('ledgerRisk')}</dt><dd>{riskLabel(report.finding.risk, t)}</dd></div>
        <div><dt>{t('ledgerProposal')}</dt><dd>{sourceLabel}</dd></div>
        <div><dt>{t('ledgerRepairStatus')}</dt><dd>{t(`repairStatus_${report.repair.status}`)}</dd></div>
      </dl>
      {source === 'agent' && <div className="notice notice--caution" role="note"><TriangleAlert size={16} /><p>{t('agentDisclaimer')}</p></div>}
      {report.repair.status === 'verified' && <div className="notice notice--caution" role="note"><ShieldCheck size={16} /><p>{t('verifiedDisclaimer')}</p></div>}
      <section className="human-gate" aria-labelledby="human-gate-title">
        <h4 id="human-gate-title"><Scale size={16} /> {t('humanGateTitle')}</h4>
        <p>{t('humanGateBody', { path: report.source.path })}</p>
        <ul className="fact-list">
          <li><span>{t('sourceCommit')}</span><code>{report.source.gitHead}</code></li>
          <li><span>{t('ledgerManager')}</span><code>{report.packageManager}</code></li>
          <li>{report.source.dirtyFilesIgnored.length ? t('dirtyIgnored', { count: report.source.dirtyFilesIgnored.length }) : t('dirtyNone')}</li>
          <li>{report.workspace.retained && report.workspace.path ? t('workspaceRetained', { path: report.workspace.path }) : t('workspaceRemoved')}</li>
        </ul>
      </section>
    </div>
  );
}

function ChecksPanel({ report, t }: { report: IsolatedUpgradeReport; t: Translate }) {
  return (
    <div className="evidence-view">
      <h3>{t('checksTitle')}</h3>
      <table className="ledger-table">
        <thead><tr><th>{t('colCheck')}</th><th>{t('colBaseline')}</th><th>{t('colCandidate')}</th><th>{t('colClassification')}</th></tr></thead>
        <tbody>
          {report.comparisons.map((comparison) => (
            <tr key={comparison.name}>
              <td><code>{comparison.name}</code></td>
              <td><StatusChip status={comparison.baseline} t={t} /></td>
              <td><StatusChip status={comparison.candidate} t={t} /></td>
              <td><span className={`state-mark state-mark--${comparison.state}`}>{t(`state_${comparison.state}`)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="docket">
        <h4>{t('diagnosticsTitle')}</h4>
        {report.repairSuggestions.length ? report.repairSuggestions.map((suggestion) => (
          <article key={`${suggestion.check}-${suggestion.classification}`} className="diagnostic">
            <div className="diagnostic-meta"><code>{suggestion.check}</code><span className={`state-mark state-mark--${suggestion.classification}`}>{t(`state_${suggestion.classification}`)}</span></div>
            <p><strong>{suggestion.summary}</strong> {suggestion.nextAction}</p>
            <p><span className="fact-label">{t('firstDiagnostic')}</span><code className="diagnostic-text">{suggestion.evidence}</code></p>
          </article>
        )) : <p className="docket-empty">{t('diagnosticsNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('unexpectedChangesTitle')}</h4>
        {report.unexpectedCandidateChanges.length ? <ul className="path-list">{report.unexpectedCandidateChanges.map((entry, index) => <li key={`${index}:${entry}`}><code>{entry}</code></li>)}</ul> : <p className="docket-empty">{t('unexpectedNone')}</p>}
      </section>
      {report.baselineSideEffects.length > 0 && (
        <section className="docket">
          <h4>{t('baselineSideEffects')}</h4>
          <ul className="path-list">{report.baselineSideEffects.map((entry, index) => <li key={`${index}:${entry}`}><code>{entry}</code></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function RepairPanel({ report, t }: { report: IsolatedUpgradeReport; t: Translate }) {
  const { repair } = report;
  const source = proposalSource(repair);
  if (!repair.requested) {
    return (
      <div className="handoff-view">
        <div className="patch-heading"><div><p>{t('repairTitle')}</p><h3>{t('repairStatus_not_requested')}</h3></div><Wrench size={24} /></div>
        <p>{t('repairNotRequested')}</p>
      </div>
    );
  }
  return (
    <div className="evidence-view">
      <div className="patch-heading">
        <div><p>{t('repairTitle')}</p><h3>{t(`repairStatus_${repair.status}`)}</h3></div>
        <span className={`verdict-mark verdict-mark--repair-${repair.status}`}>{source === 'recipe' ? t('proposalSourceRecipe') : source === 'agent' ? t('proposalSourceAgent') : t('proposalSourceNone')}</span>
      </div>
      <section className="docket">
        <h4>{t('policyConclusion')}</h4>
        <p className="docket-prose">{repair.rationale}</p>
        <p className="docket-note">{t('policyLimits', { files: repair.policy.maxFiles, lines: repair.policy.maxChangedLines, extensions: repair.policy.allowedExtensions.join(', ') })}</p>
      </section>
      {source === 'agent' && <div className="notice notice--caution" role="note"><TriangleAlert size={16} /><p>{t('agentDisclaimer')}</p></div>}
      <section className="docket">
        <h4>{t('proposalTitle')}</h4>
        {repair.proposal ? (
          <>
            <p className="docket-prose">{repair.proposal.summary}</p>
            <ul className="fact-list">
              <li><span>{t('proposalId')}</span><code>{repair.proposal.id}</code></li>
              <li>{t('proposalEdits', { count: repair.proposal.edits.length })}</li>
            </ul>
            <ol className="edit-list">
              {repair.proposal.edits.map((edit, index) => (
                <li key={`${edit.path}-${index}`}>
                  <code>{edit.path}</code>
                  <p>{edit.rationale}</p>
                  <p><span className="fact-label">{t('editDiagnostic')}</span><code className="diagnostic-text">{edit.diagnostic}</code></p>
                  <pre className="edit-pair"><code><span className="diff-remove">- {edit.expectedText}</span><span className="diff-add">+ {edit.replacement}</span></code></pre>
                </li>
              ))}
            </ol>
          </>
        ) : <p className="docket-empty">{t('proposalNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('evidenceCited')}</h4>
        {repair.evidence.length ? <ul className="prose-list">{repair.evidence.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul> : <p className="docket-empty">{t('diagnosticsNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('contextTitle')}</h4>
        {repair.contextRead.length ? repair.contextRead.map((context, index) => (
          <details key={`${index}:${context.path}:${context.startLine}`} className="context-excerpt">
            <summary><code>{`${context.path}:${context.startLine}-${context.endLine}`}</code></summary>
            <p><span className="fact-label">{t('editDiagnostic')}</span><code className="diagnostic-text">{context.diagnostic}</code></p>
            <pre><code>{context.content}</code></pre>
          </details>
        )) : <p className="docket-empty">{t('contextNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('releaseEvidenceTitle')}</h4>
        {repair.releaseEvidence.length ? <ul className="prose-list prose-list--pre">{repair.releaseEvidence.map((item, index) => <li key={`${index}:${item.slice(0, 40)}`}>{item}</li>)}</ul> : <p className="docket-empty">{t('releaseEvidenceNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('verificationTitle')}</h4>
        {repair.verificationResults.length ? <ResultsTable results={repair.verificationResults} t={t} /> : <p className="docket-empty">{t('verificationNone')}</p>}
      </section>
      <section className="docket">
        <h4>{t('repairUnexpectedTitle')}</h4>
        {repair.unexpectedChanges.length ? <ul className="path-list">{repair.unexpectedChanges.map((entry, index) => <li key={`${index}:${entry}`}><code>{entry}</code></li>)}</ul> : <p className="docket-empty">{t('unexpectedNone')}</p>}
      </section>
    </div>
  );
}

function DiffPanel({ report, t, onCopy }: { report: IsolatedUpgradeReport; t: Translate; onCopy: LocalUpgradeViewProps['onCopy'] }) {
  const lines = report.patch ? report.patch.split('\n') : [];
  return (
    <div className="patch-view">
      <div className="patch-heading">
        <div><p>{t('diffTitle')}</p><h3>{report.changedFiles.length ? t('diffFiles', { count: report.changedFiles.length }) : t('diffNone')}</h3></div>
        {report.patch && <button type="button" className="reset-button" onClick={() => onCopy(report.patch, t('patchCopied'))}><Copy size={15} /> {t('copyPatch')}</button>}
      </div>
      {report.changedFiles.length > 0 && <ul className="path-list path-list--inline">{report.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul>}
      {report.patch ? (
        <pre><code>{lines.map((line, index) => <span key={index} className={`diff-${classifyDiffLine(line)}`}>{line || ' '}</span>)}</code></pre>
      ) : <p className="docket-empty">{t('diffNone')}</p>}
      <p className="docket-note">{t('diffNote')}</p>
    </div>
  );
}

export function LocalUpgradeView(props: LocalUpgradeViewProps) {
  const { t, dateLocale, availability, form, run, view, onFormChange, onSubmit, onReset, onViewChange, onCopy } = props;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = canRunLocally(availability);
  const running = run.status === 'running';
  const report = run.status === 'ready' ? run.report : null;
  const stages = deriveLocalStages(run);
  const completedStages = stages.filter((stage) => stage.state !== 'pending' && stage.state !== 'running').length;
  const displayPackage = report?.finding.packageName ?? (run.status === 'running' ? form.packageName.trim() : '');
  const displayTarget = report?.finding.targetVersion ?? (run.status === 'running' ? form.targetVersion.trim() : '');
  const elapsed = run.status === 'running' ? elapsedLabel(run.elapsedMs, t) : '';
  const moveTab = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + localViews.length) % localViews.length;
    onViewChange(localViews[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };
  const unavailableText = availability.status === 'unavailable'
    ? t(`localUnavailable_${availability.reason}`)
    : availability.status === 'unreachable'
      ? t('localUnreachable')
      : availability.status === 'checking'
        ? t('localChecking')
        : '';
  const heading = report
    ? t('localHeadingReady', { package: displayPackage, version: displayTarget, verdict: t(`verdict_${report.verdict}`) })
    : running
      ? t('localHeadingRunning', { package: displayPackage, version: displayTarget })
      : run.status === 'error'
        ? t('localHeadingError')
        : t('localHeadingIdle');
  const summary = report
    ? t('localSummaryReady', { head: report.source.gitHead.slice(0, 7), files: report.changedFiles.length, risk: riskLabel(report.finding.risk, t) })
    : running
      ? t('localSummaryRunning', { elapsed })
      : run.status === 'error'
        ? localErrorMessage(run.error, t)
        : t('localSummaryIdle');
  const liveUpdate = running ? t('localStatusRunning') : report ? t('localStatusReady') : run.status === 'error' ? t('localStatusError') : t('localStatusIdle');

  return (
    <>
      <section className="intake intake--local" aria-labelledby="local-intake-title">
        <div className="intake-copy">
          <h2 id="local-intake-title">{t('localIntakeTitle')}</h2>
          <p>{t('localIntakeLead')}</p>
        </div>
        {!enabled && (
          <div className={`local-availability ${availability.status === 'checking' ? 'local-availability--checking' : ''}`} role="status" data-testid="local-unavailable">
            {availability.status === 'checking' ? <CircleDashed size={17} /> : <TriangleAlert size={17} />}
            <div>
              {availability.status !== 'checking' && <strong>{t('localUnavailableTitle')}</strong>}
              <span>{unavailableText}</span>
            </div>
          </div>
        )}
        <form className={`intake-form intake-form--local ${enabled ? '' : 'intake-form--disabled'}`} onSubmit={onSubmit} data-enabled={enabled}>
          <label className="field field--repository">
            <span>{t('fieldRepoPath')}</span>
            <input type="text" required maxLength={1024} value={form.repoPath} disabled={!enabled || running} onChange={(event) => onFormChange({ ...form, repoPath: event.target.value })} placeholder={t('fieldRepoPathPlaceholder')} spellCheck={false} autoComplete="off" />
          </label>
          <label className="field">
            <span>{t('fieldPackage')}</span>
            <input type="text" required maxLength={214} value={form.packageName} disabled={!enabled || running} onChange={(event) => onFormChange({ ...form, packageName: event.target.value })} placeholder="package-name" spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('fieldVersion')}</span>
            <input type="text" required maxLength={64} value={form.targetVersion} disabled={!enabled || running} onChange={(event) => onFormChange({ ...form, targetVersion: event.target.value })} placeholder="1.2.3" spellCheck={false} />
          </label>
          <div className="intake-toggles">
            <label className="toggle">
              <input type="checkbox" checked={form.attemptRepair} disabled={!enabled || running} onChange={(event) => onFormChange({ ...form, attemptRepair: event.target.checked })} />
              <span><strong>{t('toggleRepair')}</strong><small>{t('toggleRepairHint')}</small></span>
            </label>
            {enabled && availability.capabilities.keepWorkspaceAllowed && (
              <label className="toggle">
                <input type="checkbox" checked={form.keepWorkspace} disabled={running} onChange={(event) => onFormChange({ ...form, keepWorkspace: event.target.checked })} />
                <span><strong>{t('toggleKeepWorkspace')}</strong><small>{t('toggleKeepWorkspaceHint')}</small></span>
              </label>
            )}
            {enabled && availability.capabilities.projectRoot && !form.repoPath && (
              <button type="button" className="link-button" disabled={running} onClick={() => onFormChange({ ...form, repoPath: availability.capabilities.projectRoot ?? '' })}><FolderGit2 size={13} /> {t('useThisRepository')}</button>
            )}
          </div>
          <button className="inspect-button" type="submit" disabled={!enabled || running} data-testid="local-run">
            {running ? <><span className="spinner" /> {t('runningUpgrade')}</> : <><GitBranch size={16} /> {t('runUpgrade')}</>}
          </button>
        </form>
        <p className="trust-note"><ShieldCheck size={14} /> {t('localTrustNote')}</p>
        {run.status === 'error' && (
          <div className="intake-error" role="alert"><TriangleAlert size={17} /><span>{localErrorMessage(run.error, t)}</span><button type="button" onClick={onReset}>{t('dismiss')}</button></div>
        )}
      </section>

      <div className="case-heading">
        <div>
          <p className="repo-path"><FolderGit2 size={14} /> {report ? report.source.path : running ? t('localRepoRunning') : t('localRepoWaiting')} <span>{report ? t('badgeLocal') : running ? t('badgeRunning') : t('badgeWaiting')}</span></p>
          <h1>{heading}</h1>
          <p className="case-summary">{summary}</p>
        </div>
        <div className={`decision-state ${report ? 'decision-state--ready' : running ? 'decision-state--remote' : ''}`} aria-live="polite">
          {report ? <Scale size={18} /> : running ? <CircleDashed size={18} /> : <SquareTerminal size={18} />}
          <span>{liveUpdate}</span>
        </div>
      </div>

      <div className="case-grid">
        <section className="change-sheet" aria-label={t('packetLabel')}>
          <div className="sheet-binding" aria-hidden="true"><span /><span /><span /></div>
          <div className="sheet-header">
            <div className="package-title"><span className="package-monogram">{displayPackage ? packageInitial(displayPackage) : '—'}</span><div><p>{t('packageUnderReview')}</p><h2>{displayPackage || t('awaitingInspection')}</h2></div></div>
            {report ? (
              <div className="version-jump" aria-label={t('versionChange', { current: report.finding.currentVersion ?? t('unresolved'), target: report.finding.targetVersion })}><span>{report.finding.currentVersion ?? t('unresolved')}</span><ArrowRight size={18} /><strong>{report.finding.targetVersion}</strong></div>
            ) : (
              <div className="version-jump version-jump--waiting" aria-label={t('noVersionJump')}>{displayTarget ? <><span aria-hidden="true">…</span><ArrowRight size={18} /><strong>{displayTarget}</strong></> : '—'}</div>
            )}
          </div>

          <div className="sheet-tabs" role="tablist" aria-label={t('tabList')}>
            {localViews.map((tab, index) => (
              <button key={tab} ref={(element) => { tabRefs.current[index] = element; }} id={`local-tab-${tab}`} role="tab" aria-controls={`local-panel-${tab}`} aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} onClick={() => onViewChange(tab)} onKeyDown={(event) => {
                if (event.key === 'ArrowRight') { event.preventDefault(); moveTab(index, 1); }
                if (event.key === 'ArrowLeft') { event.preventDefault(); moveTab(index, -1); }
                if (event.key === 'Home') { event.preventDefault(); onViewChange(localViews[0]); tabRefs.current[0]?.focus(); }
                if (event.key === 'End') { event.preventDefault(); onViewChange(localViews.at(-1)!); tabRefs.current.at(-1)?.focus(); }
              }}>
                {tab === 'verdict' ? t('tabVerdict') : tab === 'checks' ? t('tabChecks') : tab === 'repair' ? t('tabRepair') : t('tabDiff')}
              </button>
            ))}
          </div>

          <div className="sheet-body" role="tabpanel" id={`local-panel-${view}`} aria-labelledby={`local-tab-${view}`} tabIndex={0}>
            {!report ? (
              <div className="packet-waiting">
                {running ? <CircleDashed size={22} className="spin" /> : run.status === 'error' ? <TriangleAlert size={22} /> : <SquareTerminal size={22} />}
                <h3>{running ? t('localRunningTitle') : run.status === 'error' ? t('localErrorTitle') : t('localWaitingTitle')}</h3>
                <p>{running ? t('localRunningBody', { elapsed }) : run.status === 'error' ? localErrorMessage(run.error, t) : t('localWaitingBody')}</p>
              </div>
            ) : view === 'verdict' ? (
              <VerdictPanel report={report} t={t} dateLocale={dateLocale} />
            ) : view === 'checks' ? (
              <ChecksPanel report={report} t={t} />
            ) : view === 'repair' ? (
              <RepairPanel report={report} t={t} />
            ) : (
              <DiffPanel report={report} t={t} onCopy={onCopy} />
            )}
          </div>

          <footer className="sheet-footer">
            <div className="agent-note"><SquareTerminal size={17} /><span>{t('localAgentNote')}</span><small>{t('localAgentNoteDetail')}</small></div>
            <div className="sheet-actions">
              {run.status === 'ready' ? (
                <>
                  <button className="reset-button" type="button" onClick={onReset}><RotateCcw size={15} /> {t('newRun')}</button>
                  <button className="reset-button" type="button" onClick={() => onCopy(run.markdown, t('markdownCopied'))}><FileCode size={15} /> {t('copyMarkdown')}</button>
                  <button className="primary-button" type="button" onClick={() => onCopy(JSON.stringify(run.report, null, 2), t('jsonCopied'))}><Copy size={16} /> {t('copyJson')}</button>
                </>
              ) : (
                <p className="sheet-hint">{t('localSheetHint')}</p>
              )}
            </div>
          </footer>
        </section>

        <aside className="audit-thread" aria-label={t('localThread')}>
          <div className="audit-heading"><p>{t('localThread')}</p><span>{completedStages}/{stages.length}</span></div>
          <ol>
            {stages.map((stage) => {
              const StageIcon = stage.key === 'preparation' ? PackageSearch
                : stage.key === 'baseline' ? ListChecks
                  : stage.key === 'upgrade' ? GitBranch
                    : stage.key === 'candidate' ? ListChecks
                      : stage.key === 'proposal' ? Wrench
                        : stage.key === 'policy' ? Scale
                          : ShieldCheck;
              const className = stage.state === 'passed' || stage.state === 'skipped' ? 'stage stage--done'
                : stage.state === 'running' ? 'stage stage--active'
                  : stage.state === 'failed' ? 'stage stage--failed'
                    : stage.state === 'attention' ? 'stage stage--attention'
                      : 'stage';
              return (
                <li key={stage.key} className={className} data-stage={stage.key} data-state={stage.state}>
                  <LineMark state={stage.state} />
                  <div className="stage-icon"><StageIcon size={16} /></div>
                  <div><p>{t(stage.labelKey)}</p><span>{t(stage.detailKey, stage.values)}</span></div>
                  {stage.state === 'passed' && <Check size={15} className="stage-check" />}
                  {(stage.state === 'failed' || stage.state === 'attention') && <TriangleAlert size={15} className="stage-alert" />}
                </li>
              );
            })}
          </ol>
          <div className="safety-gate"><ShieldCheck size={18} /><div><p>{t('localSafetyTitle')}</p><span>{report ? t('localSafetyReady') : running ? t('localSafetyRunning') : t('localSafetyIdle')}</span></div></div>
          {report && <div className="safety-gate safety-gate--diff"><FileDiff size={18} /><div><p>{t('humanGateTitle')}</p><span>{t('verifiedDisclaimer')}</span></div></div>}
        </aside>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{liveUpdate}</p>
    </>
  );
}

export interface LocalUpgradeConsoleProps {
  t: Translate;
  dateLocale: string;
  availability: LocalAvailability;
  onCopy: (text: string, confirmation: string) => void;
}

export function LocalUpgradeConsole({ t, dateLocale, availability, onCopy }: LocalUpgradeConsoleProps) {
  const [form, setForm] = useState<LocalUpgradeForm>(emptyLocalForm);
  const [run, setRun] = useState<LocalRunState>({ status: 'idle' });
  const [view, setView] = useState<LocalView>('verdict');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (run.status === 'running' || !canRunLocally(availability)) return;
    const startedAt = Date.now();
    setRun({ status: 'running', startedAt, elapsedMs: 0 });
    setView('verdict');
    stopTimer();
    timerRef.current = setInterval(() => {
      setRun((current) => current.status === 'running' ? { ...current, elapsedMs: Date.now() - current.startedAt } : current);
    }, 1_000);
    let settled = false;
    try {
      await streamLocalUpgrade({
        repoPath: form.repoPath.trim(),
        packageName: form.packageName.trim(),
        targetVersion: form.targetVersion.trim(),
        attemptRepair: form.attemptRepair,
        ...(form.keepWorkspace ? { keepWorkspace: true } : {}),
      }, (event) => {
        if (event.type === 'report') {
          settled = true;
          setRun({ status: 'ready', report: event.report, markdown: event.markdown });
        } else if (event.type === 'error') {
          settled = true;
          setRun({ status: 'error', error: event.error });
        } else if (event.type === 'heartbeat') {
          setRun((current) => current.status === 'running' ? { ...current, elapsedMs: event.elapsedMs } : current);
        }
      });
      if (!settled) setRun({ status: 'error', error: { code: 'RUN_FAILED', message: 'The harness closed the stream before a report was produced.' } });
    } catch (error) {
      setRun({
        status: 'error',
        error: error instanceof LocalApiRequestError
          ? error.error
          : { code: 'RUN_FAILED', message: error instanceof Error ? error.message : 'The harness could not be reached.' },
      });
    } finally {
      stopTimer();
    }
  };

  const reset = () => {
    if (run.status === 'running') return;
    setRun({ status: 'idle' });
    setView('verdict');
  };

  return (
    <LocalUpgradeView
      t={t}
      dateLocale={dateLocale}
      availability={availability}
      form={form}
      run={run}
      view={view}
      onFormChange={setForm}
      onSubmit={submit}
      onReset={reset}
      onViewChange={setView}
      onCopy={onCopy}
    />
  );
}
