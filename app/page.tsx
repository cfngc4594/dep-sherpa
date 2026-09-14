'use client';

import {
  ArrowRight,
  BookOpenText,
  Check,
  CircleCheck,
  CircleDot,
  Clock3,
  ClockArrowUp,
  CodeXml,
  Copy,
  ExternalLink,
  FileCode,
  GitBranch,
  PackageSearch,
  RotateCcw,
  Search,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteInvestigationReport } from '@/src/core/types';
import { localePreferences } from '@/src/i18n/locale';
import { useLocale, type Translate } from '@/src/i18n/use-locale';
import { LocalUpgradeConsole } from '@/src/web/local-upgrade-console';
import { ModeSwitch, type ExecutionMode } from '@/src/web/mode-switch';
import { useLocalCapabilities } from '@/src/web/use-local-capabilities';

type InspectorState = 'idle' | 'loading' | 'ready' | 'error';
type View = 'brief' | 'evidence' | 'patch';
type Surface = 'investigations' | 'history';

interface InspectorForm {
  repositoryUrl: string;
  manifestPath: string;
  packageName: string;
  targetVersion: string;
}

interface HistoryEntry {
  id: string;
  createdAt: string;
  form: InspectorForm;
  report: RemoteInvestigationReport;
}

const historyStorageKey = 'depsherpa:run-history:v1';
const historyLimit = 20;

function parseHistory(value: string | null): HistoryEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is HistoryEntry => Boolean(
      entry
      && typeof entry === 'object'
      && 'id' in entry
      && 'form' in entry
      && 'report' in entry,
    )).slice(0, historyLimit);
  } catch {
    return [];
  }
}

const views: View[] = ['brief', 'evidence', 'patch'];

const emptyForm: InspectorForm = {
  repositoryUrl: '',
  manifestPath: 'package.json',
  packageName: '',
  targetVersion: '',
};

function LineMark({ done, active }: { done: boolean; active: boolean }) {
  return <span className={`line-mark ${done ? 'line-mark--done' : ''} ${active ? 'line-mark--active' : ''}`} aria-hidden="true"><span /></span>;
}

function packageInitial(packageName: string): string {
  return packageName.split('/').at(-1)?.charAt(0).toUpperCase() || 'D';
}

function sectionLabel(section: string, t: Translate): string {
  if (section === 'devDependencies') return t('sectionDevDependencies');
  if (section === 'peerDependencies') return t('sectionPeerDependencies');
  if (section === 'optionalDependencies') return t('sectionOptionalDependencies');
  return t('sectionDependencies');
}

function sourceLabel(source: string, t: Translate): string {
  if (source === 'package-lock') return t('sourcePackageLock');
  if (source === 'bun-lock') return t('sourceBunLock');
  if (source === 'manifest-exact') return t('sourceManifestExact');
  return t('sourceManifestRange');
}

function decisionLabel(status: string, t: Translate): string {
  if (status === 'upgrade') return t('decisionUpgrade');
  if (status === 'already-installed') return t('decisionInstalled');
  if (status === 'downgrade') return t('decisionDowngrade');
  return t('decisionUnresolved');
}

function riskLabel(risk: string, t: Translate): string {
  if (risk === 'low') return t('riskLow');
  if (risk === 'medium') return t('riskMedium');
  if (risk === 'high') return t('riskHigh');
  return t('riskUnknown');
}

function errorMessage(code: string | undefined, t: Translate): string {
  if (code === 'INVALID_INPUT') return t('errorINVALID_INPUT');
  if (code === 'REPOSITORY_NOT_FOUND') return t('errorREPOSITORY_NOT_FOUND');
  if (code === 'MANIFEST_NOT_FOUND') return t('errorMANIFEST_NOT_FOUND');
  if (code === 'NPM_VERSION_NOT_FOUND') return t('errorNPM_VERSION_NOT_FOUND');
  if (code === 'UPSTREAM_RATE_LIMITED') return t('errorUPSTREAM_RATE_LIMITED');
  if (code === 'UPSTREAM_UNAVAILABLE') return t('errorUPSTREAM_UNAVAILABLE');
  return t('errorFallback');
}

export default function Home() {
  const { preference, locale, setPreference, t } = useLocale();
  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-GB';
  const [surface, setSurface] = useState<Surface>('investigations');
  const [mode, setMode] = useState<ExecutionMode>('public');
  const localAvailability = useLocalCapabilities();
  const [view, setView] = useState<View>('brief');
  const [form, setForm] = useState<InspectorForm>(emptyForm);
  const [inspectorState, setInspectorState] = useState<InspectorState>('idle');
  const [inspectorErrorCode, setInspectorErrorCode] = useState<string | undefined>();
  const [remoteReport, setRemoteReport] = useState<RemoteInvestigationReport | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const isRemote = remoteReport !== null;
  const inspectorError = inspectorErrorCode ? errorMessage(inspectorErrorCode, t) : '';

  const remoteEvidence = useMemo(() => {
    if (!remoteReport) return [];
    const availableChecks = remoteReport.checks.filter((check) => check.available).map((check) => check.name);
    return [
      ['MANIFEST', t('evidenceManifest', { package: remoteReport.finding.packageName, range: remoteReport.finding.declaredRange, section: sectionLabel(remoteReport.finding.section, t) })],
      ['BASELINE', remoteReport.baseline.message],
      ['NPM', t('evidenceNpm', { version: remoteReport.finding.targetVersion, latest: remoteReport.registry.latestVersion ?? t('evidenceNpmUnknown') })],
      ['DECISION', remoteReport.decision.message],
      ['RELEASE', remoteReport.releases.message],
      ['SOURCE', t('evidenceSource', { path: remoteReport.source.manifestPath, sha: remoteReport.source.manifestSha.slice(0, 7), branch: remoteReport.source.defaultBranch })],
      ['CHECKS', availableChecks.length ? t('evidenceChecks', { checks: availableChecks.join(', ') }) : t('evidenceNoChecks')],
      ['POLICY', t('evidencePolicy')],
    ];
  }, [remoteReport, t]);

  const stageItems = useMemo(() => {
    const blueprint = [
      { label: t('stageInventory'), idle: t('stageInventoryIdle'), icon: PackageSearch },
      { label: t('stageRelease'), idle: t('stageReleaseIdle'), icon: BookOpenText },
      { label: t('stageUpgrade'), idle: t('stageUpgradeIdle'), icon: GitBranch },
      { label: t('stageDiagnose'), idle: t('stageDiagnoseIdle'), icon: TriangleAlert },
      { label: t('stageRepair'), idle: t('stageRepairIdle'), icon: FileCode },
      { label: t('stageVerify'), idle: t('stageVerifyIdle'), icon: ShieldCheck },
    ];
    if (!remoteReport) return blueprint;
    const availableChecks = remoteReport.checks.filter((check) => check.available).length;
    const noUpgrade = remoteReport.decision.status === 'already-installed';
    const localUpgradeAvailable = remoteReport.decision.status === 'upgrade' && remoteReport.packageManager === 'npm';
    return [
      { ...blueprint[0], idle: `${remoteReport.packageManager} · ${remoteReport.baseline.path ?? remoteReport.source.manifestPath} · ${remoteReport.source.manifestSha.slice(0, 7)}` },
      { ...blueprint[1], idle: remoteReport.releases.status === 'found' ? t('stageReleaseFound', { count: remoteReport.releases.notes.length }) : t('stageReleaseMissing') },
      { ...blueprint[2], idle: noUpgrade ? t('stageUpgradeSkip') : localUpgradeAvailable ? t('stageUpgradeReady') : t('stageUpgradeBlocked', { manager: remoteReport.packageManager }) },
      { ...blueprint[3], idle: noUpgrade ? t('stageDiagnoseSkip') : localUpgradeAvailable ? t('stageDiagnoseReady') : t('stageDiagnoseWait') },
      { ...blueprint[4], idle: noUpgrade ? t('stageRepairSkip') : localUpgradeAvailable ? t('stageRepairReady') : t('stageRepairWait') },
      { ...blueprint[5], idle: t('stageVerifyCount', { count: availableChecks, state: noUpgrade ? t('stageVerifyOptional') : t('stageVerifyPending') }) },
    ];
  }, [remoteReport, t]);

  const clearInspection = () => {
    setRemoteReport(null);
    setInspectorState('idle');
    setInspectorErrorCode(undefined);
    setView('brief');
  };

  const submitRemoteInvestigation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inspectorState === 'loading') return;
    setInspectorState('loading');
    setInspectorErrorCode(undefined);
    setCopyStatus('');

    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as {
        report?: RemoteInvestigationReport;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || !payload.report) {
        throw Object.assign(new Error(payload.error?.message || t('errorFallback')), { code: payload.error?.code });
      }
      setRemoteReport(payload.report);
      const historyEntry: HistoryEntry = {
        id: `${payload.report.generatedAt}:${payload.report.repository}:${payload.report.finding.packageName}:${payload.report.finding.targetVersion}`,
        createdAt: payload.report.generatedAt,
        form: { ...form },
        report: payload.report,
      };
      let storedHistory = history;
      try {
        storedHistory = parseHistory(window.localStorage.getItem(historyStorageKey));
      } catch {
        // Continue with in-memory history when browser storage is unavailable.
      }
      const nextHistory = [
        historyEntry,
        ...storedHistory.filter((entry) => !(
          entry.form.repositoryUrl === historyEntry.form.repositoryUrl
          && entry.form.manifestPath === historyEntry.form.manifestPath
          && entry.form.packageName === historyEntry.form.packageName
          && entry.form.targetVersion === historyEntry.form.targetVersion
        )),
      ].slice(0, historyLimit);
      setHistory(nextHistory);
      try {
        window.localStorage.setItem(historyStorageKey, JSON.stringify(nextHistory));
      } catch {
        // History remains available for this tab when browser storage is unavailable.
      }
      setInspectorState('ready');
      setView('brief');
    } catch (error) {
      setInspectorState('error');
      setInspectorErrorCode(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined);
    }
  };

  const copyText = async (text: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(confirmation);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyStatus(''), 2600);
    } catch {
      setCopyStatus(t('clipboardBlocked'));
    }
  };

  const moveTab = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + views.length) % views.length;
    setView(views[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const openHistoryEntry = (entry: HistoryEntry) => {
    setForm(entry.form);
    setRemoteReport(entry.report);
    setInspectorState('ready');
    setInspectorErrorCode(undefined);
    setView('brief');
    setSurface('investigations');
  };

  const clearHistory = () => {
    if (!history.length || !window.confirm(t('historyClearConfirm'))) return;
    setHistory([]);
    try {
      window.localStorage.removeItem(historyStorageKey);
    } catch {
      // In-memory history is still cleared.
    }
  };

  const showHistory = () => {
    try {
      setHistory(parseHistory(window.localStorage.getItem(historyStorageKey)));
    } catch {
      // Keep the current in-memory history when browser storage is unavailable.
    }
    setSurface('history');
  };

  const finding = remoteReport?.finding;
  const isNoUpgrade = remoteReport?.decision.status === 'already-installed';
  const canRunLocalUpgrade = remoteReport?.decision.status === 'upgrade' && remoteReport.packageManager === 'npm';
  const displayPackage = finding?.packageName ?? '';
  const displayCurrent = remoteReport?.baseline.version ?? (isRemote ? t('unresolved') : '');
  const displayTarget = finding?.targetVersion ?? '';
  const completedStages = isRemote ? 2 : 0;
  const cliCommand = remoteReport && canRunLocalUpgrade
    ? `npm run depsherpa -- upgrade /path/to/checkout ${remoteReport.finding.packageName} ${remoteReport.finding.targetVersion} --attempt-repair`
    : '';

  const liveUpdate = inspectorState === 'loading'
    ? t('liveLoading')
    : inspectorState === 'error'
      ? inspectorError
      : isRemote
        ? isNoUpgrade
          ? t('liveInstalled')
          : canRunLocalUpgrade
            ? t('liveReady')
            : t('liveUnsupported', { manager: remoteReport.packageManager })
        : t('liveIdle');

  return (
    <main className="app-shell">
      <aside className="rail" aria-label={t('investigations')}>
        <div className="brand-mark" aria-label="DepSherpa"><span className="brand-d">D</span><span className="brand-rule" /></div>
        <nav className="rail-nav">
          <button className={`rail-action ${surface === 'investigations' ? 'rail-action--active' : ''}`} aria-current={surface === 'investigations' ? 'page' : undefined} aria-label={t('investigations')} title={t('investigations')} onClick={() => setSurface('investigations')}><PackageSearch size={19} /></button>
          <button className={`rail-action ${surface === 'history' ? 'rail-action--active' : ''}`} aria-current={surface === 'history' ? 'page' : undefined} aria-label={history.length ? t('historySaved', { count: history.length }) : t('history')} title={t('history')} onClick={showHistory}><ClockArrowUp size={19} /></button>
        </nav>
        <a className="rail-action rail-github" href="https://github.com/cfngc4594/dep-sherpa" target="_blank" rel="noreferrer" aria-label={t('github')} title={t('github')}><CodeXml size={19} /></a>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="wordmark">DepSherpa</p><p className="wordmark-note">{t('brandNote')}</p></div>
          <div className="topbar-tools">
            <div className={`mode-badge ${surface !== 'history' && mode === 'local' ? 'mode-badge--local' : ''}`} aria-label={surface === 'history' ? t('modeHistoryHint') : mode === 'local' ? localAvailability.status === 'enabled' ? t('modeLocalBadgeHint') : t('modeLocalBadgeUnavailableHint') : t('modeLiveHint')}>
              {surface === 'history' ? <ClockArrowUp size={14} /> : mode === 'local' ? <SquareTerminal size={14} /> : <CircleDot size={14} />}{surface === 'history' ? t('modeHistory') : mode === 'local' ? localAvailability.status === 'enabled' ? t('modeLocalBadge') : t('modeLocalBadgeUnavailable') : t('modeLive')}
            </div>
            <label className="locale-switch">
              <span>{t('language')}</span>
              <select aria-label={t('language')} value={preference} onChange={(event) => setPreference(event.target.value as typeof preference)}>
                {localePreferences.map((option) => (
                  <option key={option} value={option}>
                    {option === 'system' ? t('languageSystem') : option === 'en' ? t('languageEnglish') : t('languageChinese')}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {surface === 'history' ? (
          <section className="history-view" aria-labelledby="history-title">
            <div className="history-heading">
              <div>
                <p>{t('historyKicker')}</p>
                <h1 id="history-title">{t('historyTitle')}</h1>
                <span>{t('historyLead')}</span>
              </div>
              <button type="button" className="history-clear" onClick={clearHistory} disabled={!history.length}>{t('historyClear')}</button>
            </div>

            {history.length ? (
              <ol className="history-list">
                {history.map((entry) => (
                  <li key={entry.id} className="history-card">
                    <button type="button" onClick={() => openHistoryEntry(entry)} aria-label={t('historyOpen', { repository: entry.report.repository, package: entry.report.finding.packageName, version: entry.report.finding.targetVersion })}>
                      <div className="history-card-topline">
                        <span>{entry.report.repository}</span>
                        <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</time>
                      </div>
                      <div className="history-card-main">
                        <span className="history-monogram">{packageInitial(entry.report.finding.packageName)}</span>
                        <div>
                          <h2>{entry.report.finding.packageName}</h2>
                          <p>{entry.report.baseline.version ?? t('unresolved')} <ArrowRight size={13} /> {entry.report.finding.targetVersion}</p>
                        </div>
                        <span className={`history-status history-status--${entry.report.decision.status}`}>{decisionLabel(entry.report.decision.status, t)}</span>
                      </div>
                      <div className="history-card-footer">
                        <span>{entry.report.packageManager}</span>
                        <span>{t('riskValue', { risk: riskLabel(entry.report.finding.risk, t) })}</span>
                        <span>{sourceLabel(entry.report.baseline.source, t)}</span>
                        <strong>{t('historyOpenReport')} <ArrowRight size={13} /></strong>
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="history-empty">
                <ClockArrowUp size={30} />
                <h2>{t('historyEmptyTitle')}</h2>
                <p>{t('historyEmptyBody')}</p>
                <button type="button" className="primary-button" onClick={() => setSurface('investigations')}><PackageSearch size={16} /> {t('historyStart')}</button>
              </div>
            )}
          </section>
        ) : (
          <>
        <ModeSwitch t={t} mode={mode} availability={localAvailability} onChange={setMode} />
        {mode === 'local' ? (
          <LocalUpgradeConsole t={t} dateLocale={dateLocale} availability={localAvailability} onCopy={copyText} />
        ) : (
          <>

        <section className="intake" aria-labelledby="intake-title">
          <div className="intake-copy">
            <h2 id="intake-title">{t('intakeTitle')}</h2>
            <p>{t('intakeLead')}</p>
          </div>
          <form className="intake-form" onSubmit={submitRemoteInvestigation}>
            <label className="field field--repository">
              <span>{t('fieldRepository')}</span>
              <input type="url" required maxLength={300} value={form.repositoryUrl} onChange={(event) => setForm((current) => ({ ...current, repositoryUrl: event.target.value }))} placeholder="https://github.com/owner/repository" autoComplete="url" />
            </label>
            <label className="field field--manifest">
              <span>{t('fieldManifest')}</span>
              <input type="text" required maxLength={240} value={form.manifestPath} onChange={(event) => setForm((current) => ({ ...current, manifestPath: event.target.value }))} placeholder="package.json" spellCheck={false} />
            </label>
            <label className="field">
              <span>{t('fieldPackage')}</span>
              <input type="text" required maxLength={214} value={form.packageName} onChange={(event) => setForm((current) => ({ ...current, packageName: event.target.value }))} placeholder="package-name" spellCheck={false} />
            </label>
            <label className="field">
              <span>{t('fieldVersion')}</span>
              <input type="text" required maxLength={64} value={form.targetVersion} onChange={(event) => setForm((current) => ({ ...current, targetVersion: event.target.value }))} placeholder="1.2.3" spellCheck={false} />
            </label>
            <button className="inspect-button" type="submit" disabled={inspectorState === 'loading'}>
              {inspectorState === 'loading' ? <><span className="spinner" /> {t('inspecting')}</> : <><Search size={16} /> {t('inspect')}</>}
            </button>
          </form>
          {inspectorState === 'error' && (
            <div className="intake-error" role="alert"><TriangleAlert size={17} /><span>{inspectorError}</span><button type="button" onClick={() => setInspectorState(isRemote ? 'ready' : 'idle')}>{t('dismiss')}</button></div>
          )}
        </section>

        <div className="case-heading">
          <div>
            <p className="repo-path"><CodeXml size={14} /> {isRemote ? `${remoteReport.source.owner} / ${remoteReport.source.name}` : inspectorState === 'loading' ? t('repoLoading') : t('repoWaiting')} <span>{isRemote ? t('badgePublic') : t('badgeWaiting')}</span></p>
            <h1>{isRemote ? isNoUpgrade ? t('headingInstalled', { package: displayPackage, version: displayTarget }) : t('headingInvestigate', { package: displayPackage, version: displayTarget }) : inspectorState === 'loading' ? t('headingLoading') : t('headingIdle')}</h1>
            <p className="case-summary">{isRemote ? isNoUpgrade ? t('summaryInstalled', { decision: remoteReport.decision.message }) : t('summaryUpgrade', { decision: remoteReport.decision.message, risk: riskLabel(finding?.risk ?? 'unknown', t) }) : t('summaryIdle')}</p>
          </div>
          <div className={`decision-state ${isRemote ? 'decision-state--remote' : ''}`} aria-live="polite">
            {isRemote ? <BookOpenText size={18} /> : inspectorState === 'loading' ? <Search size={18} /> : <Clock3 size={18} />}
            <span>{isRemote ? isNoUpgrade ? t('statusInstalled') : t('statusReady') : inspectorState === 'loading' ? t('statusLoading') : t('statusIdle')}</span>
          </div>
        </div>

        <div className="case-grid">
          <section className="change-sheet" aria-label={t('packetLabel')}>
            <div className="sheet-binding" aria-hidden="true"><span /><span /><span /></div>
            <div className="sheet-header">
              <div className="package-title"><span className="package-monogram">{displayPackage ? packageInitial(displayPackage) : '—'}</span><div><p>{t('packageUnderReview')}</p><h2>{displayPackage || t('awaitingInspection')}</h2></div></div>
              {isRemote ? (
                <div className="version-jump" aria-label={isNoUpgrade ? t('versionMatches', { current: displayCurrent }) : t('versionChange', { current: displayCurrent, target: displayTarget })}><span>{displayCurrent}</span>{isNoUpgrade ? <Check size={18} /> : <ArrowRight size={18} />}<strong>{displayTarget}</strong></div>
              ) : (
                <div className="version-jump version-jump--waiting" aria-label={t('noVersionJump')}>—</div>
              )}
            </div>

            <div className="sheet-tabs" role="tablist" aria-label={t('tabList')}>
              {views.map((tab, index) => (
                <button key={tab} ref={(element) => { tabRefs.current[index] = element; }} id={`tab-${tab}`} role="tab" aria-controls={`panel-${tab}`} aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)} onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') { event.preventDefault(); moveTab(index, 1); }
                  if (event.key === 'ArrowLeft') { event.preventDefault(); moveTab(index, -1); }
                  if (event.key === 'Home') { event.preventDefault(); setView(views[0]); tabRefs.current[0]?.focus(); }
                  if (event.key === 'End') { event.preventDefault(); setView(views.at(-1)!); tabRefs.current.at(-1)?.focus(); }
                }}>
                  {tab === 'brief' ? t('tabBrief') : tab === 'evidence' ? t('tabEvidence') : t('tabHandoff')}
                </button>
              ))}
            </div>

            <div className="sheet-body" role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} tabIndex={0}>
              {!isRemote ? (
                <div className="packet-waiting">
                  <Search size={22} />
                  <h3>{inspectorState === 'loading' ? t('fetchingTitle') : t('waitingTitle')}</h3>
                  <p>{inspectorState === 'loading' ? t('fetchingBody') : t('waitingBody')}</p>
                </div>
              ) : view === 'brief' ? (
                <div className="brief-view">
                  <div className="margin-note">{`SHA ${remoteReport.source.manifestSha.slice(0, 7).toUpperCase()}`}<br />{new Intl.DateTimeFormat(dateLocale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date())}</div>
                  <h3>{isNoUpgrade ? t('briefInstalled') : finding?.releaseType === 'major' ? t('briefMajor') : t('briefSignal')}</h3>
                  <p>{`${remoteReport.registry.description ?? displayPackage} ${remoteReport.baseline.message} ${remoteReport.decision.message}`}</p>
                  <dl className="risk-ledger">
                    <div><dt>{t('ledgerSurface')}</dt><dd>{sectionLabel(finding!.section, t)}</dd></div>
                    <div><dt>{t('ledgerManager')}</dt><dd>{remoteReport.packageManager}</dd></div>
                    <div><dt>{t('ledgerSource')}</dt><dd>{sourceLabel(remoteReport.baseline.source, t)}</dd></div>
                    <div><dt>{t('ledgerWrites')}</dt><dd>{t('writesBlocked')}</dd></div>
                  </dl>
                  <div className="proof-note">
                    <BookOpenText size={17} />
                    <p><strong>{t('evidenceRetained')}</strong><br />
                      <span className="source-links">
                        <a href={`${remoteReport.source.url}/blob/${remoteReport.source.defaultBranch}/${remoteReport.source.manifestPath}`} target="_blank" rel="noreferrer">{t('linkManifest')} <ExternalLink size={11} /></a>
                        <a href={`https://www.npmjs.com/package/${remoteReport.finding.packageName}/v/${remoteReport.finding.targetVersion}`} target="_blank" rel="noreferrer">{t('linkNpm')} <ExternalLink size={11} /></a>
                        {remoteReport.releases.notes[0] && <a href={remoteReport.releases.notes[0].url} target="_blank" rel="noreferrer">{t('linkRelease')} <ExternalLink size={11} /></a>}
                      </span>
                    </p>
                  </div>
                </div>
              ) : view === 'evidence' ? (
                <div className="evidence-view">
                  <h3>{t('evidenceCount', { count: remoteEvidence.length })}</h3>
                  <div className="evidence-list">
                    {remoteEvidence.map(([kind, text]) => {
                      const sourceGap = kind === 'RELEASE' && remoteReport.releases.status !== 'found';
                      return <div key={`${kind}-${text}`} className={`evidence-row evidence-row--visible ${sourceGap ? 'evidence-row--gap' : ''}`}><span>{kind}</span><p>{text}</p>{sourceGap ? <TriangleAlert size={16} /> : <Check size={16} />}</div>;
                    })}
                  </div>
                  <section className="release-docket" aria-labelledby="release-docket-title">
                    <div className="release-docket-heading">
                      <h4 id="release-docket-title">{t('releaseDocket')}</h4>
                      <span>{remoteReport.releases.status === 'found' ? t('releaseRetained', { count: remoteReport.releases.notes.length }) : t('releaseGap')}</span>
                    </div>
                    {remoteReport.releases.notes.length ? (
                      <div className="release-note-list">
                        {remoteReport.releases.notes.map((note) => (
                          <article key={note.url} className="release-note">
                            <div className="release-note-meta"><span>{note.tag}</span><time dateTime={note.publishedAt ?? undefined}>{note.publishedAt ? new Intl.DateTimeFormat(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(note.publishedAt)) : t('dateUnavailable')}</time></div>
                            <h5><a href={note.url} target="_blank" rel="noreferrer">{note.title}<ExternalLink size={12} /></a></h5>
                            <p>{note.excerpt}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="release-empty"><TriangleAlert size={16} /><p><strong>{t('noReleaseTitle')}</strong><br />{remoteReport.releases.message} {t('noReleaseAdvice')}</p></div>
                    )}
                  </section>
                </div>
              ) : isNoUpgrade ? (
                <div className="handoff-view">
                  <div className="patch-heading"><div><p>{t('noopKicker')}</p><h3>{t('noopTitle')}</h3></div><CircleCheck size={24} /></div>
                  <p>{remoteReport.baseline.message} {t('noopBody')}</p>
                  <div className="check-roster" aria-label={t('optionalChecks')}>
                    {remoteReport.checks.map((check) => <span key={check.name} className={check.available ? 'check-chip check-chip--available' : 'check-chip'}>{check.available ? <Check size={13} /> : <span aria-hidden="true">—</span>}{check.name}</span>)}
                  </div>
                </div>
              ) : !canRunLocalUpgrade ? (
                <div className="handoff-view">
                  <div className="patch-heading"><div><p>{t('boundaryKicker')}</p><h3>{t('boundaryUnavailable')}</h3></div><TriangleAlert size={24} /></div>
                  <p>{remoteReport.decision.message} {remoteReport.packageManager === 'npm' ? t('boundaryNpm') : t('boundaryOther', { manager: remoteReport.packageManager })}</p>
                  <div className="check-roster" aria-label={t('discoveredChecks')}>
                    {remoteReport.checks.map((check) => <span key={check.name} className={check.available ? 'check-chip check-chip--available' : 'check-chip'}>{check.available ? <Check size={13} /> : <span aria-hidden="true">—</span>}{check.name}</span>)}
                  </div>
                </div>
              ) : (
                <div className="handoff-view">
                  <div className="patch-heading"><div><p>{t('boundaryKicker')}</p><h3>{t('boundaryRepair')}</h3></div><ShieldCheck size={24} /></div>
                  <p>{t('boundaryRepairBody')}</p>
                  <div className="command-block"><code>{cliCommand}</code><button type="button" onClick={() => copyText(cliCommand, t('commandCopied'))} aria-label={t('copyCommand')}><Copy size={15} /></button></div>
                  <div className="check-roster" aria-label={t('discoveredChecks')}>
                    {remoteReport.checks.map((check) => <span key={check.name} className={check.available ? 'check-chip check-chip--available' : 'check-chip'}>{check.available ? <Check size={13} /> : <span aria-hidden="true">—</span>}{check.name}</span>)}
                  </div>
                </div>
              )}
            </div>

            <footer className="sheet-footer">
              <div className="agent-note"><SquareTerminal size={17} /><span>{t('agentNote')}</span><small>{t('agentNoteDetail')}</small></div>
              <div className="sheet-actions">
                {isRemote ? (
                  <>
                    <button className="reset-button" type="button" onClick={clearInspection}><RotateCcw size={15} /> {t('newInspection')}</button>
                    <button className="primary-button" type="button" onClick={() => copyText(JSON.stringify(remoteReport, null, 2), t('reportCopied'))}><Copy size={16} /> {t('copyReport')}</button>
                  </>
                ) : (
                  <p className="sheet-hint">{t('sheetHint')}</p>
                )}
              </div>
            </footer>
          </section>

          <aside className="audit-thread" aria-label={t('thread')}>
            <div className="audit-heading"><p>{t('thread')}</p><span>{completedStages}/{stageItems.length}</span></div>
            <ol>
              {stageItems.map((stageItem, index) => {
                const done = isRemote && index < 2;
                const active = !isRemote && inspectorState === 'loading' && index === 0;
                const StageIcon = stageItem.icon;
                return <li key={stageItem.label} className={done ? 'stage stage--done' : active ? 'stage stage--active' : 'stage'}><LineMark done={done} active={active} /><div className="stage-icon"><StageIcon size={16} /></div><div><p>{stageItem.label}</p><span>{stageItem.idle}</span></div>{done && <Check size={15} className="stage-check" />}</li>;
              })}
            </ol>
            <div className="safety-gate"><ShieldCheck size={18} /><div><p>{t('safetyClosed')}</p><span>{isRemote ? t('safetyRemote') : t('safetyIdle')}</span></div></div>
          </aside>
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{liveUpdate}</p>
          </>
        )}
        <p className="copy-toast" aria-live="polite">{copyStatus}</p>
          </>
        )}
      </section>
    </main>
  );
}
