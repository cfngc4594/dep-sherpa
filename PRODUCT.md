# Product

<!-- impeccable:product-schema 1 -->

## Platform

GitHub Action (with a command-line interface sharing the same core)

## Stack

Delegated: TypeScript and Node.js, packaged as a GitHub Action, with the official `openai` SDK for any OpenAI-compatible model endpoint. The stack stays close to the owner's day-to-day TypeScript experience so the repository remains credible and maintainable after the hackathon.

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
- The product is a GitHub Action running on the maintainer's own CI runner when Dependabot or Renovate opens a dependency pull request; nobody has to clone DepSherpa or configure credentials to get a report.
- The CLI is a secondary entry point to the same deterministic core for local reproduction and debugging.

## Capabilities and Constraints

- Inspect dependencies and identify an upgrade target.
- Summarize the version jump and relevant migration evidence.
- Copy the committed Git state into a disposable local clone, apply an exact npm target there, and never modify the source repository silently.
- Run that same isolated upgrade as a GitHub Action: detect the single dependency change of a pull request, investigate from the base commit on the runner, and publish a job summary, an artifact, and one report comment. The Action's only write is that comment.
- Run declared lint, typecheck, test, and build checks with timeouts.
- Route any dependency regression with attributable source diagnostics into a generic, controlled candidate-patch flow. High-confidence recipes can produce a proposal quickly; otherwise a configured no-tool model over an OpenAI-compatible endpoint (any base URL plus API key) may return a structured proposal from bounded evidence.
- Apply no proposal until deterministic policy confirms exact tracked source context, allowed paths and extensions, a three-file/twelve-line limit, diagnostic attribution, and reproducibility. Apply accepted edits only in the disposable clone and rerun every declared check.
- Require human approval before exporting a patch or creating a draft pull request.
- Keep every path usable without credentials: recipes, `demo:repair`, and the Action all run with no API key; a model only adds proposals for failures no recipe covers.
- First release targets npm-compatible TypeScript projects. Other ecosystems are open decisions.
- GitHub write access and automated pull-request creation are deliberately deferred until the owner explicitly authorizes them.

## Brand Commitments

The name is DepSherpa. The voice is precise, calm, and candid about uncertainty. It should feel like a senior maintainer preparing a change-control packet, not a chatbot improvising a fix.

## Evidence on Hand

- `npm run demo:repair` runs a real isolated Zod 3→4 upgrade against a committed fixture, including a failing typecheck, a bounded repair, and a green verification run.
- The local npm runner records baseline and candidate checks, classifies introduced versus pre-existing failures, retains bounded first-error diagnostics with check-specific next steps, and emits a manifest/lockfile patch from a disposable clone.
- A real Zod 3.23.8→4.1.5 run produced the expected TypeScript failures, changed one compiler-attributed source line, passed all four post-repair checks, and returned `repaired_ready_for_review` without changing the source repository.
- A package-agnostic test closes the same loop for a Monaco-style unknown API diagnostic using an injected structured Agent proposal, including verified and failed-verification outcomes.
- The GitHub Action path reproduced the Zod run end to end against a shallow Dependabot-style pull request checkout: the change was detected from base versus head `package.json`, the base commit was fetched and cloned separately, the isolated upgrade and recipe repair ran, and the report was written as job summary, outputs, and artifact files with the workspace left untouched.
- The product promises that any npm upgrade can be investigated and considered for a controlled proposal, not that every upgrade can be repaired automatically.
- No customers, usage metrics, production integrations, or award claims exist and none may be fabricated.

## Product Principles

- Evidence before recommendation.
- Isolation before mutation.
- Human approval before external effects.
- Every conclusion should link back to a command, diff, or source.
- The demo must remain useful as an open-source starter, not only as a contest video.

## Accessibility & Inclusion

Reports are plain Markdown and JSON so they remain readable in the GitHub UI, in screen readers, and in any editor; status is always stated in words, never by color alone.
