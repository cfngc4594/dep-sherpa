---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/globals.css","app/layout.tsx"]
---

## Scope and mode

The main product workspace (`app/page.tsx`) in Operate mode.

## Audience, job, and action

A solo TypeScript maintainer inspects a real public repository before moving into local execution. The packet stays empty until they submit a repository. The first live action is **Inspect repository**.

## Proof and content

The inspector reads a public GitHub `package.json`, verifies an exact npm version, matches relevant GitHub Releases from the package source, and discovers declared checks. Every conclusion points to GitHub or npm evidence; missing release prose is labeled as a source gap rather than inferred. No canned repository, version jump, patch, or command result is shown before those sources answer.

## Constraints

The interface must work without AWS credentials, remain keyboard-operable, and adapt to phone widths. The local handoff may describe the shipped isolated npm runner and its opt-in bounded Zod repair, but it must name the trust boundary for repository scripts and must not imply that hosted repository code ran or that a GitHub pull request was created.

## Direction and memorable moment

The visual world is an editorial change ledger: off-white revision sheets on a carbon workbench, vermilion proof marks, blue-black ink, ruled annotations, and dense but calm typesetting. The first viewport is not a dashboard overview; it is the waiting change packet itself. The signature interaction is the empty packet filling only after public sources return evidence.

## Unresolved decisions

GitHub OAuth for private repositories, repository changelog fallback, model-proposed general repair recipes, isolated hosted execution, and cloud model/provider configuration remain intentionally deferred.
