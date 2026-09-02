'use client';

import {
  ArrowRight,
  BookOpenText,
  Check,
  CircleCheck,
  CircleDot,
  Clock3,
  FileCode,
  GitBranch,
  ClockArrowUp,
  CodeXml,
  PackageSearch,
  Play,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type RunState = 'idle' | 'running' | 'ready' | 'approved';
type View = 'brief' | 'evidence' | 'patch';

const views: View[] = ['brief', 'evidence', 'patch'];

const stages = [
  { label: 'Repository inventory', detail: 'pnpm workspace · 37 direct dependencies', icon: PackageSearch },
  { label: 'Release evidence', detail: '3 relevant migration notes retained', icon: BookOpenText },
  { label: 'Isolated upgrade', detail: 'worktree depsherpa/zod-4.1.5', icon: GitBranch },
  { label: 'Failure diagnosis', detail: '1 breaking API reference located', icon: TriangleAlert },
  { label: 'Bounded repair', detail: '2 lines changed · no public API drift', icon: FileCode },
  { label: 'Verification', detail: 'typecheck · 48 tests · production build', icon: ShieldCheck },
];

const evidence = [
  ['CHANGELOG', 'ZodError.errors was replaced by .issues in v4.'],
  ['COMMAND', 'pnpm typecheck → TS2339 at validation.ts:42'],
  ['PATCH', 'Mapped error.errors to error.issues in one call site.'],
  ['COMMAND', 'pnpm test → 48 passed in 6.2s'],
  ['COMMAND', 'pnpm build → completed in 11.8s'],
];

function LineMark({ done, active }: { done: boolean; active: boolean }) {
  return <span className={`line-mark ${done ? 'line-mark--done' : ''} ${active ? 'line-mark--active' : ''}`} aria-hidden="true"><span /></span>;
}

export default function Home() {
  const [runState, setRunState] = useState<RunState>('idle');
  const [step, setStep] = useState(-1);
  const [view, setView] = useState<View>('brief');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const runInvestigation = () => {
    if (runState === 'running') return;
    setRunState('running');
    setStep(0);
    setView('brief');
    let next = 0;
    const advance = () => {
      next += 1;
      if (next < stages.length) {
        setStep(next);
        timerRef.current = setTimeout(advance, 560);
      } else {
        setRunState('ready');
        setStep(stages.length);
        setView('patch');
      }
    };
    timerRef.current = setTimeout(advance, 560);
  };

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunState('idle');
    setStep(-1);
    setView('brief');
  };

  const finished = runState === 'ready' || runState === 'approved';
  const liveUpdate = runState === 'running' && step >= 0
    ? `Investigation stage ${step + 1} of ${stages.length}: ${stages[step]?.label}`
    : runState === 'ready'
      ? 'Investigation complete. The patch is waiting for human approval.'
      : runState === 'approved'
        ? 'Patch approved locally. No external write was performed.'
        : 'Investigation has not started.';

  const moveTab = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + views.length) % views.length;
    setView(views[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="DepSherpa"><span className="brand-d">D</span><span className="brand-rule" /></div>
        <nav className="rail-nav">
          <span className="rail-action rail-action--active" aria-current="page" aria-label="Investigations" title="Investigations"><PackageSearch size={19} /></span>
          <button className="rail-action" aria-label="Policies — coming later" title="Policies — coming later" disabled><ShieldCheck size={19} /></button>
          <button className="rail-action" aria-label="Run history — coming later" title="Run history — coming later" disabled><ClockArrowUp size={19} /></button>
        </nav>
        <a className="rail-action rail-github" href="https://github.com/cfngc4594" target="_blank" rel="noreferrer" aria-label="GitHub profile" title="GitHub profile"><CodeXml size={19} /></a>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="wordmark">DepSherpa</p><p className="wordmark-note">dependency change control</p></div>
          <div className="mode-badge" aria-label="Current execution mode: deterministic demo"><CircleDot size={14} />Deterministic demo</div>
        </header>

        <div className="case-heading">
          <div>
            <p className="repo-path"><CodeXml size={14} /> acme / checkout-ui <span>SYNTHETIC</span></p>
            <h1>Investigate Zod 4 before it lands.</h1>
            <p className="case-summary">One breaking change, one isolated repair, and a decision that still belongs to you.</p>
          </div>
          <div className={`decision-state decision-state--${runState}`} aria-live="polite">
            {runState === 'approved' ? <CircleCheck size={18} /> : <Clock3 size={18} />}
            <span>{runState === 'approved' ? 'Approved locally' : finished ? 'Awaiting approval' : runState === 'running' ? 'Investigation running' : 'Not investigated'}</span>
          </div>
        </div>

        <div className="case-grid">
          <section className="change-sheet" aria-label="Dependency change packet">
            <div className="sheet-binding" aria-hidden="true"><span /><span /><span /></div>
            <div className="sheet-header">
              <div className="package-title"><span className="package-monogram">Z</span><div><p>PACKAGE UNDER REVIEW</p><h2>zod</h2></div></div>
              <div className="version-jump" aria-label="Version change from 3.23.8 to 4.1.5"><span>3.23.8</span><ArrowRight size={18} /><strong>4.1.5</strong></div>
            </div>

            <div className="sheet-tabs" role="tablist" aria-label="Investigation views">
              {views.map((tab, index) => (
                <button
                  key={tab}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={`tab-${tab}`}
                  role="tab"
                  aria-controls={`panel-${tab}`}
                  aria-selected={view === tab}
                  tabIndex={view === tab ? 0 : -1}
                  onClick={() => setView(tab)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') { event.preventDefault(); moveTab(index, 1); }
                    if (event.key === 'ArrowLeft') { event.preventDefault(); moveTab(index, -1); }
                    if (event.key === 'Home') { event.preventDefault(); setView(views[0]); tabRefs.current[0]?.focus(); }
                    if (event.key === 'End') { event.preventDefault(); setView(views.at(-1)!); tabRefs.current.at(-1)?.focus(); }
                  }}
                >
                  {tab === 'brief' ? 'Change brief' : tab === 'evidence' ? 'Evidence' : 'Patch'}
                </button>
              ))}
            </div>

            <div className="sheet-body" role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} tabIndex={0}>
              {view === 'brief' && (
                <div className="brief-view">
                  <div className="margin-note">DS–0147<br />02 SEP 2026</div>
                  <h3>The version bump is small. The contract change is not.</h3>
                  <p>Zod 4 changes the error collection property used by the checkout validator. DepSherpa will reproduce the failure inside a temporary worktree, make only the documented API substitution, then rerun the repository&apos;s own checks.</p>
                  <dl className="risk-ledger">
                    <div><dt>Surface</dt><dd>1 call site</dd></div>
                    <div><dt>Policy</dt><dd>patch-only repair</dd></div>
                    <div><dt>Network</dt><dd>read evidence only</dd></div>
                    <div><dt>External writes</dt><dd>blocked</dd></div>
                  </dl>
                  <div className="proof-note"><BookOpenText size={17} /><p><strong>Primary evidence retained</strong><br />Official migration notes and the repository&apos;s own compiler output will be attached to this packet.</p></div>
                </div>
              )}

              {view === 'evidence' && (
                <div className="evidence-view">
                  <h3>Every conclusion has a receipt.</h3>
                  <div className="evidence-list">
                    {evidence.map(([kind, text], index) => (
                      <div key={text} className={step > index || finished ? 'evidence-row evidence-row--visible' : 'evidence-row'}>
                        <span>{kind}</span><p>{text}</p>{step > index || finished ? <Check size={16} /> : <span className="evidence-wait">—</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {view === 'patch' && (
                <div className="patch-view">
                  <div className="patch-heading"><div><p>src/lib/validation.ts</p><h3>One bounded repair</h3></div><span className="diff-count">+1 −1</span></div>
                  <pre aria-label="Proposed source patch"><code><span className="diff-context">{'  if (error instanceof ZodError) {'}</span>{'\n'}<span className="diff-remove">-   return error.errors.map(formatIssue);</span>{'\n'}<span className="diff-add">+   return error.issues.map(formatIssue);</span>{'\n'}<span className="diff-context">{'  }'}</span></code></pre>
                  <div className="verification-strip"><span><CircleCheck size={16} /> typecheck</span><span><CircleCheck size={16} /> 48 tests</span><span><CircleCheck size={16} /> build</span></div>
                </div>
              )}
            </div>

            <footer className="sheet-footer">
              <div className="agent-note"><SquareTerminal size={17} /><span>Strands orchestration</span><small>credential-free replay</small></div>
              <div className="sheet-actions">
                {runState !== 'idle' && <button className="reset-button" onClick={reset} disabled={runState === 'running'}><RotateCcw size={15} /> Reset</button>}
                {!finished ? (
                  <button className="primary-button" onClick={runInvestigation} disabled={runState === 'running'}>
                    {runState === 'running' ? <><span className="spinner" /> Investigating…</> : <><Play size={16} fill="currentColor" /> Run investigation</>}
                  </button>
                ) : (
                  <button className="primary-button" onClick={() => setRunState('approved')} disabled={runState === 'approved'}><Check size={17} /> {runState === 'approved' ? 'Patch approved' : 'Approve patch'}</button>
                )}
              </div>
            </footer>
            {finished && (
              <button
                className={`approval-stamp ${runState === 'approved' ? 'approval-stamp--approved' : 'approval-stamp--pending'}`}
                onClick={() => setRunState('approved')}
                disabled={runState === 'approved'}
                aria-label={runState === 'approved' ? 'Patch approved locally' : 'Approve this patch'}
              >
                {runState === 'approved' ? 'APPROVED' : 'SIGN OFF'}<br />
                <span>{runState === 'approved' ? 'LOCAL ONLY' : 'HUMAN REQUIRED'}</span>
              </button>
            )}
          </section>

          <aside className="audit-thread" aria-label="Investigation progress">
            <div className="audit-heading"><p>Investigation thread</p><span>{Math.max(0, Math.min(step, stages.length))}/{stages.length}</span></div>
            <ol>
              {stages.map((stageItem, index) => {
                const done = step > index || finished;
                const active = runState === 'running' && step === index;
                const StageIcon = stageItem.icon;
                return (
                  <li key={stageItem.label} className={done ? 'stage stage--done' : active ? 'stage stage--active' : 'stage'}>
                    <LineMark done={done} active={active} /><div className="stage-icon"><StageIcon size={16} /></div><div><p>{stageItem.label}</p><span>{stageItem.detail}</span></div>{done && <Check size={15} className="stage-check" />}
                  </li>
                );
              })}
            </ol>
            <div className="safety-gate"><ShieldCheck size={18} /><div><p>Safety gate is closed</p><span>No branch, pull request, or message can leave this demo.</span></div></div>
          </aside>
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{liveUpdate}</p>
      </section>
    </main>
  );
}
