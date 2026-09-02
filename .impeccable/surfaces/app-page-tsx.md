---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/globals.css","app/layout.tsx"]
---

## Scope and mode

The main product workspace (`app/page.tsx`) in Operate mode.

## Audience, job, and action

A solo TypeScript maintainer can inspect a real public repository before moving into local execution, or replay a prepared dependency investigation and approve or reject its proposed patch. The first live action is **Inspect repository**; the deterministic path retains **Run investigation** and **Approve patch**.

## Proof and content

The release retains the clearly labeled synthetic `acme/checkout-ui` scenario and adds a separately labeled live path that reads a public GitHub `package.json`, verifies an exact npm version, matches relevant GitHub Releases from the package source, and discovers declared checks. Every live conclusion points to GitHub or npm evidence; missing release prose is labeled as a source gap rather than inferred. Every synthetic conclusion points to release evidence, a command, or a diff.

## Constraints

The interface must work without AWS credentials, distinguish real read-only evidence from simulated execution, preserve an obvious human approval gate for the synthetic patch, remain keyboard-operable, and adapt to phone widths. The local handoff may describe the shipped isolated npm runner and its opt-in bounded Zod repair, but it must name the trust boundary for repository scripts and must not imply that hosted repository code ran or that a GitHub pull request was created.

## Direction and memorable moment

The visual world is an editorial change ledger: off-white revision sheets on a carbon workbench, vermilion proof marks, blue-black ink, ruled annotations, and dense but calm typesetting. The first viewport is not a dashboard overview; it is the active change packet itself. The signature interaction is the evidence thread physically advancing through the document as each investigation stage completes, ending at an approval stamp that remains visibly unpressed until the user acts.

## Unresolved decisions

GitHub OAuth for private repositories, repository changelog fallback, model-proposed general repair recipes, isolated hosted execution, and cloud model/provider configuration remain intentionally deferred.
