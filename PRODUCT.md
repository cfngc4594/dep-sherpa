# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: TypeScript and Node.js, packaged first as a GitHub Action, with the official `openai` SDK for any OpenAI-compatible model endpoint and Next.js/Tailwind for the secondary web console. The stack stays close to the owner's day-to-day TypeScript experience so the repository remains credible and maintainable after the hackathon.

## Users

The primary user is a solo or small-team JavaScript/TypeScript maintainer who needs to upgrade dependencies without spending an evening reconstructing release notes, migration steps, and test failures.

## Product Purpose

DepSherpa investigates one dependency upgrade end to end. It inventories the repository, gathers release evidence, performs the candidate change in isolation, runs the project's checks, explains any failure, and prepares a reviewable patch. Success means a maintainer can make an informed approve-or-reject decision from one compact evidence trail.

## Positioning

DepSherpa is not an update bot that opens a version-bump pull request. Its differentiator is an explicit investigation loop: evidence collection, isolated execution, failure diagnosis, bounded repair, verification, and a human approval gate before any outward action.

## Operating Context

- The user starts from a Git repository containing `package.json` and a supported lockfile.
- Investigations happen alongside ordinary development work and should be resumable.
- Commands, release-note excerpts, patches, and check results form the audit trail.
- The primary experience is a GitHub Action running on the maintainer's own CI runner when Dependabot or Renovate opens a dependency pull request; nobody has to clone DepSherpa or configure credentials to get a report.
- The CLI and the local web console (`npm run dev` on the maintainer's machine) are secondary entry points to the same deterministic core. A publicly hosted DepSherpa offers read-only investigation only and explicitly rejects local execution.

## Capabilities and Constraints

- Inspect dependencies and identify an upgrade target.
- Inspect a public GitHub repository and verify a requested version against the npm registry without cloning or executing it.
- Match GitHub Releases from the npm package's declared source repository to the requested semantic-version range, retaining bounded excerpts and source links.
- Summarize the version jump and relevant migration evidence.
- Copy the committed Git state into a disposable local clone, apply an exact npm target there, and never modify the source repository silently.
- Run that same isolated upgrade as a GitHub Action: detect the single dependency change of a pull request, investigate from the base commit on the runner, and publish a job summary, an artifact, and one report comment. The Action's only write is that comment.
- Trigger the isolated upgrade from the local web console through a restricted loopback API that accepts only a local Git-root path, a package name, an exact version, and a repair toggle; the browser never runs commands or reads the filesystem, and hosted deployments never expose an executable endpoint.
- Run declared lint, typecheck, test, and build checks with timeouts.
- Route any dependency regression with attributable source diagnostics into a generic, controlled candidate-patch flow. High-confidence recipes can produce a proposal quickly; otherwise a configured no-tool model over an OpenAI-compatible endpoint (any base URL plus API key) may return a structured proposal from bounded evidence.
- Apply no proposal until deterministic policy confirms exact tracked source context, allowed paths and extensions, a three-file/twelve-line limit, diagnostic attribution, and reproducibility. Apply accepted edits only in the disposable clone and rerun every declared check.
- Require human approval before exporting a patch or creating a draft pull request.
- Keep every path usable without credentials: recipes, `demo:repair`, the inspector, and the Action all run with no API key; a model only adds proposals for failures no recipe covers.
- First release targets npm-compatible TypeScript projects. Other ecosystems are open decisions.
- GitHub write access and automated pull-request creation are deliberately deferred until the owner explicitly authorizes them.

## Brand Commitments

The name is DepSherpa. The voice is precise, calm, and candid about uncertainty. It should feel like a senior maintainer preparing a change-control packet, not a chatbot improvising a fix.

## Evidence on Hand

- `npm run demo:repair` runs a real isolated Zod 3→4 upgrade against a committed fixture, including a failing typecheck, a bounded repair, and a green verification run.
- The hosted inspector can read a selected `package.json` from a public GitHub repository and confirm an exact target version through npm.
- The hosted inspector can retain up to six matching GitHub Release records, with an explicit source-gap state when no match is available.
- The local npm runner records baseline and candidate checks, classifies introduced versus pre-existing failures, retains bounded first-error diagnostics with check-specific next steps, and emits a manifest/lockfile patch from a disposable clone.
- A real Zod 3.23.8→4.1.5 run produced the expected TypeScript failures, changed one compiler-attributed source line, passed all four post-repair checks, and returned `repaired_ready_for_review` without changing the source repository.
- A package-agnostic test closes the same loop for a Monaco-style unknown API diagnostic using an injected structured Agent proposal, including verified and failed-verification outcomes.
- The GitHub Action path reproduced the Zod run end to end against a shallow Dependabot-style pull request checkout: the change was detected from base versus head `package.json`, the base commit was fetched and cloned separately, the isolated upgrade and recipe repair ran, and the report was written as job summary, outputs, and artifact files with the workspace left untouched.
- The local web console reproduced the same run through `POST /api/local/upgrade`, rendered as stages, check comparison, repair provenance, complete diff, and a human decision gate.
- The product promises that any npm upgrade can be investigated and considered for a controlled proposal, not that every upgrade can be repaired automatically.
- No customers, usage metrics, production integrations, or award claims exist and none may be fabricated.

## Product Principles

- Evidence before recommendation.
- Isolation before mutation.
- Human approval before external effects.
- Every conclusion should link back to a command, diff, or source.
- The demo must remain useful as an open-source starter, not only as a contest video.

## Accessibility & Inclusion

The web interface must be keyboard operable, responsive, motion-reduced when requested, and must not communicate status by color alone.
