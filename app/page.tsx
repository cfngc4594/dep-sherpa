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
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteInvestigationReport } from '@/src/core/types';

type RunState = 'idle' | 'running' | 'ready' | 'approved';
type InspectorState = 'idle' | 'loading' | 'ready' | 'error';
type View = 'brief' | 'evidence' | 'patch';

interface InspectorForm {
  repositoryUrl: string;
  manifestPath: string;
  packageName: string;
  targetVersion: string;
}

const views: View[] = ['brief', 'evidence', 'patch'];

const baseStages = [
  { label: 'Repository inventory', detail: 'pnpm workspace · 37 direct dependencies', icon: PackageSearch },
  { label: 'Release evidence', detail: '3 relevant migration notes retained', icon: BookOpenText },
  { label: 'Isolated upgrade', detail: 'worktree depsherpa/zod-4.1.5', icon: GitBranch },
  { label: 'Failure diagnosis', detail: '1 breaking API reference located', icon: TriangleAlert },
  { label: 'Bounded repair', detail: '2 lines changed · no public API drift', icon: FileCode },
  { label: 'Verification', detail: 'typecheck · 48 tests · production build', icon: ShieldCheck },
];

const syntheticEvidence = [
  ['CHANGELOG', 'ZodError.errors was replaced by .issues in v4.'],
  ['COMMAND', 'pnpm typecheck → TS2339 at validation.ts:42'],
  ['PATCH', 'Mapped error.errors to error.issues in one call site.'],
  ['COMMAND', 'pnpm test → 48 passed in 6.2s'],
  ['COMMAND', 'pnpm build → completed in 11.8s'],
];

const initialForm: InspectorForm = {
  repositoryUrl: 'https://github.com/colinhacks/zod',
  manifestPath: 'package.json',
  packageName: 'typescript',
  targetVersion: '5.9.3',
};

function LineMark({ done, active }: { done: boolean; active: boolean }) {
  return <span className={`line-mark ${done ? 'line-mark--done' : ''} ${active ? 'line-mark--active' : ''}`} aria-hidden="true"><span /></span>;
}

function packageInitial(packageName: string): string {
  return packageName.split('/').at(-1)?.charAt(0).toUpperCase() || 'D';
}

function humanizeSection(section: string): string {
  return section.replace(/([A-Z])/g, ' $1').toLowerCase();
}

export default function Home() {
  const [runState, setRunState] = useState<RunState>('idle');
  const [step, setStep] = useState(-1);
  const [view, setView] = useState<View>('brief');
  const [form, setForm] = useState<InspectorForm>(initialForm);
  const [inspectorState, setInspectorState] = useState<InspectorState>('idle');
  const [inspectorError, setInspectorError] = useState('');
  const [remoteReport, setRemoteReport] = useState<RemoteInvestigationReport | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const isRemote = remoteReport !== null;
  const finished = !isRemote && (runState === 'ready' || runState === 'approved');

  const remoteEvidence = useMemo(() => {
    if (!remoteReport) return [];
    const availableChecks = remoteReport.checks.filter((check) => check.available).map((check) => check.name);
    return [
      ['MANIFEST', `${remoteReport.finding.packageName} is declared as ${remoteReport.finding.declaredRange} in ${humanizeSection(remoteReport.finding.section)}.`],
      ['NPM', `${remoteReport.finding.targetVersion} exists; npm latest points to ${remoteReport.registry.latestVersion ?? 'an unreported version'}.`],
      ['SOURCE', `${remoteReport.source.manifestPath} at ${remoteReport.source.manifestSha.slice(0, 7)} on ${remoteReport.source.defaultBranch}.`],
      ['CHECKS', availableChecks.length ? `Discovered ${availableChecks.join(', ')} scripts for the local runner.` : 'No standard verification scripts were declared.'],
      ['POLICY', 'No repository code was cloned, executed, changed, or pushed by this web inspection.'],
    ];
  }, [remoteReport]);

  const stageItems = useMemo(() => {
    if (!remoteReport) return baseStages;
    const availableChecks = remoteReport.checks.filter((check) => check.available).length;
    return [
      { ...baseStages[0], detail: `${remoteReport.packageManager} · ${remoteReport.source.manifestPath} · ${remoteReport.source.manifestSha.slice(0, 7)}` },
      { ...baseStages[1], label: 'Registry evidence', detail: `npm confirmed ${remoteReport.finding.packageName}@${remoteReport.finding.targetVersion}` },
      { ...baseStages[2], detail: 'Requires an isolated local checkout' },
      { ...baseStages[3], detail: 'Waiting for repository checks' },
      { ...baseStages[4], detail: 'No patch proposed in read-only mode' },
      { ...baseStages[5], detail: `${availableChecks} checks discovered · not executed` },
    ];
  }, [remoteReport]);

  const runInvestigation = () => {
    if (runState === 'running') return;
    setRunState('running');
    setStep(0);
    setView('brief');
    let next = 0;
    const advance = () => {
      next += 1;
      if (next < baseStages.length) {
        setStep(next);
        timerRef.current = setTimeout(advance, 560);
      } else {
        setRunState('ready');
        setStep(baseStages.length);
        setView('patch');
      }
    };
    timerRef.current = setTimeout(advance, 560);
  };

  const resetDemo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRemoteReport(null);
    setInspectorState('idle');
    setInspectorError('');
    setRunState('idle');
    setStep(-1);
    setView('brief');
  };

  const submitRemoteInvestigation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inspectorState === 'loading') return;
    setInspectorState('loading');
    setInspectorError('');
    setCopyStatus('');

    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as {
        report?: RemoteInvestigationReport;
        error?: { message?: string };
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error?.message || 'The investigation could not be completed.');
      }
      setRemoteReport(payload.report);
      setInspectorState('ready');
      setRunState('idle');
      setStep(-1);
      setView('brief');
    } catch (error) {
      setInspectorState('error');
      setInspectorError(error instanceof Error ? error.message : 'The investigation could not be completed.');
    }
  };

  const copyText = async (text: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(confirmation);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyStatus(''), 2600);
    } catch {
      setCopyStatus('Clipboard access was blocked. Select the text and copy it manually.');
    }
  };

  const moveTab = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + views.length) % views.length;
    setView(views[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const finding = remoteReport?.finding;
  const displayPackage = finding?.packageName ?? 'zod';
  const displayCurrent = finding?.currentVersion ?? (isRemote ? 'unknown' : '3.23.8');
  const displayTarget = finding?.targetVersion ?? '4.1.5';
  const displayedEvidence = isRemote ? remoteEvidence : syntheticEvidence;
  const completedStages = isRemote ? 2 : Math.max(0, Math.min(step, baseStages.length));
  const cliCommand = remoteReport
    ? `npm run depsherpa -- inspect /path/to/checkout ${remoteReport.finding.packageName} ${remoteReport.finding.targetVersion} --run-checks`
    : '';

  const liveUpdate = inspectorState === 'loading'
    ? 'Reading public GitHub and npm evidence.'
    : inspectorState === 'error'
      ? inspectorError
      : isRemote
        ? 'Remote evidence is ready. Local execution is still required.'
        : runState === 'running' && step >= 0
          ? `Investigation stage ${step + 1} of ${baseStages.length}: ${baseStages[step]?.label}`
          : runState === 'ready'
            ? 'Investigation complete. The patch is waiting for human approval.'
            : runState === 'approved'
              ? 'Patch approved locally. No external write was performed.'
              : 'Investigation has not started.';

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="DepSherpa"><span className="brand-d">D</span><span className="brand-rule" /></div>
        <nav className="rail-nav">
          <span className="rail-action rail-action--active" aria-current="page" aria-label="Investigations" title="Investigations"><PackageSearch size={19} /></span>
          <button className="rail-action" aria-label="Policies — coming later" title="Policies — coming later" disabled><ShieldCheck size={19} /></button>
          <button className="rail-action" aria-label="Run history — coming later" title="Run history — coming later" disabled><ClockArrowUp size={19} /></button>
        </nav>
        <a className="rail-action rail-github" href="https://github.com/cfngc4594/dep-sherpa" target="_blank" rel="noreferrer" aria-label="DepSherpa on GitHub" title="DepSherpa on GitHub"><CodeXml size={19} /></a>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="wordmark">DepSherpa</p><p className="wordmark-note">dependency change control</p></div>
          <div className="mode-badge" aria-label={isRemote ? 'Current execution mode: live read-only evidence' : 'Current execution mode: deterministic demo'}>
            <CircleDot size={14} />{isRemote ? 'Live read-only evidence' : 'Deterministic demo'}
          </div>
        </header>

        <section className="intake" aria-labelledby="intake-title">
          <div className="intake-copy">
            <h2 id="intake-title">Inspect a public repository</h2>
            <p>Read one manifest and verify one npm target. No clone, install, command, or GitHub write occurs here.</p>
          </div>
          <form className="intake-form" onSubmit={submitRemoteInvestigation}>
            <label className="field field--repository">
              <span>GitHub repository</span>
              <input type="url" required maxLength={300} value={form.repositoryUrl} onChange={(event) => setForm((current) => ({ ...current, repositoryUrl: event.target.value }))} placeholder="https://github.com/owner/repository" autoComplete="url" />
            </label>
            <label className="field field--manifest">
              <span>Manifest path</span>
              <input type="text" required maxLength={240} value={form.manifestPath} onChange={(event) => setForm((current) => ({ ...current, manifestPath: event.target.value }))} placeholder="package.json" spellCheck={false} />
            </label>
            <label className="field">
              <span>Dependency</span>
              <input type="text" required maxLength={214} value={form.packageName} onChange={(event) => setForm((current) => ({ ...current, packageName: event.target.value }))} placeholder="zod" spellCheck={false} />
            </label>
            <label className="field">
              <span>Target version</span>
              <input type="text" required maxLength={64} value={form.targetVersion} onChange={(event) => setForm((current) => ({ ...current, targetVersion: event.target.value }))} placeholder="4.1.5" spellCheck={false} />
            </label>
            <button className="inspect-button" type="submit" disabled={inspectorState === 'loading'}>
              {inspectorState === 'loading' ? <><span className="spinner" /> Reading evidence…</> : <><Search size={16} /> Inspect repository</>}
            </button>
          </form>
          {inspectorState === 'error' && (
            <div className="intake-error" role="alert"><TriangleAlert size={17} /><span>{inspectorError}</span><button type="button" onClick={() => setInspectorState('idle')}>Dismiss</button></div>
          )}
        </section>

        <div className="case-heading">
          <div>
            <p className="repo-path"><CodeXml size={14} /> {isRemote ? `${remoteReport.source.owner} / ${remoteReport.source.name}` : 'acme / checkout-ui'} <span>{isRemote ? 'PUBLIC SOURCE' : 'SYNTHETIC'}</span></p>
            <h1>{isRemote ? `Investigate ${displayPackage}@${displayTarget} before you install it.` : 'Investigate Zod 4 before it lands.'}</h1>
            <p className="case-summary">{isRemote ? `Manifest and registry evidence classify this as a ${finding?.releaseType ?? 'non-standard'} change with ${finding?.risk ?? 'unknown'} risk. Repository execution remains local-only.` : 'One breaking change, one isolated repair, and a decision that still belongs to you.'}</p>
          </div>
          <div className={`decision-state ${isRemote ? 'decision-state--remote' : `decision-state--${runState}`}`} aria-live="polite">
            {runState === 'approved' && !isRemote ? <CircleCheck size={18} /> : isRemote ? <BookOpenText size={18} /> : <Clock3 size={18} />}
            <span>{isRemote ? 'Evidence ready · execution pending' : runState === 'approved' ? 'Approved locally' : finished ? 'Awaiting approval' : runState === 'running' ? 'Investigation running' : 'Not investigated'}</span>
          </div>
        </div>

        <div className="case-grid">
          <section className="change-sheet" aria-label="Dependency change packet">
            <div className="sheet-binding" aria-hidden="true"><span /><span /><span /></div>
            <div className="sheet-header">
              <div className="package-title"><span className="package-monogram">{packageInitial(displayPackage)}</span><div><p>PACKAGE UNDER REVIEW</p><h2>{displayPackage}</h2></div></div>
              <div className="version-jump" aria-label={`Version change from ${displayCurrent} to ${displayTarget}`}><span>{displayCurrent}</span><ArrowRight size={18} /><strong>{displayTarget}</strong></div>
            </div>

            <div className="sheet-tabs" role="tablist" aria-label="Investigation views">
              {views.map((tab, index) => (
                <button key={tab} ref={(element) => { tabRefs.current[index] = element; }} id={`tab-${tab}`} role="tab" aria-controls={`panel-${tab}`} aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)} onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') { event.preventDefault(); moveTab(index, 1); }
                  if (event.key === 'ArrowLeft') { event.preventDefault(); moveTab(index, -1); }
                  if (event.key === 'Home') { event.preventDefault(); setView(views[0]); tabRefs.current[0]?.focus(); }
                  if (event.key === 'End') { event.preventDefault(); setView(views.at(-1)!); tabRefs.current.at(-1)?.focus(); }
                }}>
                  {tab === 'brief' ? 'Change brief' : tab === 'evidence' ? 'Evidence' : isRemote ? 'Local handoff' : 'Patch'}
                </button>
              ))}
            </div>

            <div className="sheet-body" role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} tabIndex={0}>
              {view === 'brief' && (
                <div className="brief-view">
                  <div className="margin-note">{isRemote ? `SHA ${remoteReport.source.manifestSha.slice(0, 7).toUpperCase()}` : 'DS–0147'}<br />{new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</div>
                  <h3>{isRemote ? (finding?.releaseType === 'major' ? 'A major boundary deserves an isolated run.' : 'The manifest gives us the first risk signal.') : 'The version bump is small. The contract change is not.'}</h3>
                  <p>{isRemote ? `${remoteReport.registry.description ?? displayPackage} DepSherpa confirmed the requested npm version and inspected the repository manifest. ${finding?.reasons.join(' ')}` : 'Zod 4 changes the error collection property used by the checkout validator. DepSherpa will reproduce the failure inside a temporary worktree, make only the documented API substitution, then rerun the repository’s own checks.'}</p>
                  <dl className="risk-ledger">
                    <div><dt>Surface</dt><dd>{isRemote ? humanizeSection(finding!.section) : '1 call site'}</dd></div>
                    <div><dt>Package manager</dt><dd>{isRemote ? remoteReport.packageManager : 'pnpm'}</dd></div>
                    <div><dt>{isRemote ? 'Default branch' : 'Network'}</dt><dd>{isRemote ? remoteReport.source.defaultBranch : 'read evidence only'}</dd></div>
                    <div><dt>External writes</dt><dd>blocked</dd></div>
                  </dl>
                  <div className="proof-note">
                    <BookOpenText size={17} />
                    <p><strong>{isRemote ? 'Two primary sources retained' : 'Primary evidence retained'}</strong><br />{isRemote ? (
                      <span className="source-links">
                        <a href={`${remoteReport.source.url}/blob/${remoteReport.source.defaultBranch}/${remoteReport.source.manifestPath}`} target="_blank" rel="noreferrer">GitHub manifest <ExternalLink size={11} /></a>
                        <a href={`https://www.npmjs.com/package/${remoteReport.finding.packageName}/v/${remoteReport.finding.targetVersion}`} target="_blank" rel="noreferrer">npm version <ExternalLink size={11} /></a>
                      </span>
                    ) : 'Official migration notes and the repository’s own compiler output will be attached to this packet.'}</p>
                  </div>
                </div>
              )}

              {view === 'evidence' && (
                <div className="evidence-view">
                  <h3>{isRemote ? 'The remote conclusion has five receipts.' : 'Every conclusion has a receipt.'}</h3>
                  <div className="evidence-list">
                    {displayedEvidence.map(([kind, text], index) => {
                      const visible = isRemote || step > index || finished;
                      return <div key={`${kind}-${text}`} className={visible ? 'evidence-row evidence-row--visible' : 'evidence-row'}><span>{kind}</span><p>{text}</p>{visible ? <Check size={16} /> : <span className="evidence-wait">—</span>}</div>;
                    })}
                  </div>
                </div>
              )}

              {view === 'patch' && (isRemote ? (
                <div className="handoff-view">
                  <div className="patch-heading"><div><p>LOCAL EXECUTION BOUNDARY</p><h3>No patch exists yet—and that is intentional.</h3></div><ShieldCheck size={24} /></div>
                  <p>The hosted inspector never executes untrusted repository code. Clone the project you trust, then hand the same dependency request to the isolated CLI runner.</p>
                  <div className="command-block"><code>{cliCommand}</code><button type="button" onClick={() => copyText(cliCommand, 'Local runner command copied.')} aria-label="Copy local runner command"><Copy size={15} /></button></div>
                  <div className="check-roster" aria-label="Discovered project checks">
                    {remoteReport.checks.map((check) => <span key={check.name} className={check.available ? 'check-chip check-chip--available' : 'check-chip'}>{check.available ? <Check size={13} /> : <span aria-hidden="true">—</span>}{check.name}</span>)}
                  </div>
                </div>
              ) : (
                <div className="patch-view">
                  <div className="patch-heading"><div><p>src/lib/validation.ts</p><h3>One bounded repair</h3></div><span className="diff-count">+1 −1</span></div>
                  <pre aria-label="Proposed source patch"><code><span className="diff-context">{'  if (error instanceof ZodError) {'}</span>{'\n'}<span className="diff-remove">-   return error.errors.map(formatIssue);</span>{'\n'}<span className="diff-add">+   return error.issues.map(formatIssue);</span>{'\n'}<span className="diff-context">{'  }'}</span></code></pre>
                  <div className="verification-strip"><span><CircleCheck size={16} /> typecheck</span><span><CircleCheck size={16} /> 48 tests</span><span><CircleCheck size={16} /> build</span></div>
                </div>
              ))}
            </div>

            <footer className="sheet-footer">
              <div className="agent-note"><SquareTerminal size={17} /><span>{isRemote ? 'Remote evidence intake' : 'Strands orchestration'}</span><small>{isRemote ? 'GitHub + npm · no execution' : 'credential-free replay'}</small></div>
              <div className="sheet-actions">
                {isRemote ? <><button className="reset-button" type="button" onClick={resetDemo}><RotateCcw size={15} /> Use demo</button><button className="primary-button" type="button" onClick={() => copyText(JSON.stringify(remoteReport, null, 2), 'Evidence report copied as JSON.')}><Copy size={16} /> Copy report</button></> : <>
                  {runState !== 'idle' && <button className="reset-button" onClick={resetDemo} disabled={runState === 'running'}><RotateCcw size={15} /> Reset</button>}
                  {!finished ? <button className="primary-button" onClick={runInvestigation} disabled={runState === 'running'}>{runState === 'running' ? <><span className="spinner" /> Investigating…</> : <><Play size={16} fill="currentColor" /> Run investigation</>}</button> : <button className="primary-button" onClick={() => setRunState('approved')} disabled={runState === 'approved'}><Check size={17} /> {runState === 'approved' ? 'Patch approved' : 'Approve patch'}</button>}
                </>}
              </div>
            </footer>
            {!isRemote && finished && <button className={`approval-stamp ${runState === 'approved' ? 'approval-stamp--approved' : 'approval-stamp--pending'}`} onClick={() => setRunState('approved')} disabled={runState === 'approved'} aria-label={runState === 'approved' ? 'Patch approved locally' : 'Approve this patch'}>{runState === 'approved' ? 'APPROVED' : 'SIGN OFF'}<br /><span>{runState === 'approved' ? 'LOCAL ONLY' : 'HUMAN REQUIRED'}</span></button>}
          </section>

          <aside className="audit-thread" aria-label="Investigation progress">
            <div className="audit-heading"><p>Investigation thread</p><span>{completedStages}/{baseStages.length}</span></div>
            <ol>
              {stageItems.map((stageItem, index) => {
                const done = isRemote ? index < 2 : step > index || finished;
                const active = !isRemote && runState === 'running' && step === index;
                const StageIcon = stageItem.icon;
                return <li key={stageItem.label} className={done ? 'stage stage--done' : active ? 'stage stage--active' : 'stage'}><LineMark done={done} active={active} /><div className="stage-icon"><StageIcon size={16} /></div><div><p>{stageItem.label}</p><span>{stageItem.detail}</span></div>{done && <Check size={15} className="stage-check" />}</li>;
              })}
            </ol>
            <div className="safety-gate"><ShieldCheck size={18} /><div><p>Safety gate is closed</p><span>{isRemote ? 'Public metadata was read. No repository code ran.' : 'No branch, pull request, or message can leave this demo.'}</span></div></div>
          </aside>
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{liveUpdate}</p>
        <p className="copy-toast" aria-live="polite">{copyStatus}</p>
      </section>
    </main>
  );
}
