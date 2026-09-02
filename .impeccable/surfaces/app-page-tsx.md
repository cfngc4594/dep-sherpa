---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/globals.css","app/layout.tsx"]
---

## Scope and mode

The main product workspace (`app/page.tsx`) in Operate mode.

## Audience, job, and action

A solo TypeScript maintainer opens a prepared dependency investigation, sees exactly what changed and why, runs the investigation, then approves or rejects the proposed patch. The primary action is **Run investigation** until evidence is complete, followed by **Approve patch**.

## Proof and content

The first release uses a clearly labeled synthetic `acme/checkout-ui` scenario: Zod 3.23.8 to 4.1.5, one documented breaking API rename, an initial typecheck failure, a two-line repair, 48 passing tests, and a clean build. Every conclusion points to release evidence, a command, or a diff.

## Constraints

The interface must work without AWS credentials in deterministic demo mode, preserve an obvious human approval gate, remain keyboard-operable, and adapt to phone widths. It must not imply that a GitHub pull request has been created.

## Direction and memorable moment

The visual world is an editorial change ledger: off-white revision sheets on a carbon workbench, vermilion proof marks, blue-black ink, ruled annotations, and dense but calm typesetting. The first viewport is not a dashboard overview; it is the active change packet itself. The signature interaction is the evidence thread physically advancing through the document as each investigation stage completes, ending at an approval stamp that remains visibly unpressed until the user acts.

## Unresolved decisions

Real GitHub OAuth, automatic release-note retrieval, and cloud model/provider configuration remain intentionally deferred.
