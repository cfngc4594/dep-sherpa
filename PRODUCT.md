# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: TypeScript, Next.js, Tailwind CSS, and the Strands Agents TypeScript SDK. The stack stays close to the owner's day-to-day TypeScript/Next.js experience so the repository remains credible and maintainable after the hackathon.

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
- The hackathon demonstration includes both a synthetic end-to-end scenario and a live, read-only public-repository evidence path; each mode is clearly labeled.

## Capabilities and Constraints

- Inspect dependencies and identify an upgrade target.
- Inspect a public GitHub repository and verify a requested version against the npm registry without cloning or executing it.
- Summarize the version jump and relevant migration evidence.
- Work in an isolated branch or worktree and never modify the source repository silently.
- Run declared lint, typecheck, test, and build checks with timeouts.
- Attempt bounded, explainable repairs and record every mutation.
- Require human approval before exporting a patch or creating a draft pull request.
- Use the Strands Agents SDK for orchestration; provide a deterministic demo mode when cloud credentials are absent.
- First release targets npm-compatible TypeScript projects. Other ecosystems are open decisions.
- GitHub write access and automated pull-request creation are deliberately deferred until the owner explicitly authorizes them.

## Brand Commitments

The name is DepSherpa. The voice is precise, calm, and candid about uncertainty. It should feel like a senior maintainer preparing a change-control packet, not a chatbot improvising a fix.

## Evidence on Hand

- A synthetic `acme/checkout-ui` scenario demonstrates a Zod v3-to-v4 migration, including a failing typecheck, a bounded repair, and a green verification run.
- The hosted inspector can read a selected `package.json` from a public GitHub repository and confirm an exact target version through npm.
- No customers, usage metrics, production integrations, or award claims exist and none may be fabricated.

## Product Principles

- Evidence before recommendation.
- Isolation before mutation.
- Human approval before external effects.
- Every conclusion should link back to a command, diff, or source.
- The demo must remain useful as an open-source starter, not only as a contest video.

## Accessibility & Inclusion

The web interface must be keyboard operable, responsive, motion-reduced when requested, and must not communicate status by color alone.
