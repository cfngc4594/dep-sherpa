# DepSherpa

DepSherpa is a GitHub Action that turns a dependency-bump pull request into a change-control packet. A CLI with the same core is included for local reproduction. On the runner it upgrades the dependency inside a disposable clone of the base commit, compares the repository's own `lint`, `typecheck`, `test`, and `build` before and after, may propose a bounded source repair, verifies it, and reports back — as a job summary, an artifact, and one pull-request comment. It never commits, pushes, or writes to the repository; the human decision stays with the reviewer.

**License:** [MIT](LICENSE) · Devpost copy: [docs/DEVPOST.md](docs/DEVPOST.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Security: [SECURITY.md](SECURITY.md)

## Quick start

Add one workflow. No API key is required for the report itself: the isolated upgrade, the check comparison, the diagnostics, and the deterministic repair recipes run without any model. An OpenAI-compatible key (one repository secret) additionally enables model-generated repair proposals for failures no recipe covers.

```yaml
# .github/workflows/depsherpa.yml
name: DepSherpa
on:
  pull_request:
    paths: [package.json]
permissions:
  contents: read
  pull-requests: write   # one report comment
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cfngc4594/dep-sherpa@main
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}   # optional; omit to run recipes only
```

When Dependabot or Renovate opens a PR that changes one dependency in `package.json`, DepSherpa reads the change from the base and head manifests, checks out the base commit in a separate clone, and runs the upgrade there. The PR receives a comment like:

> **DepSherpa · `zod` 3.23.8 → 4.1.5 — repaired · ready for review**
> baseline vs candidate check table · diagnostics · repair: verified, source: recipe · candidate patch · *human decision required*

The complete Markdown report is written to the job summary, and `report.json`, `report.md`, and `candidate.patch` are uploaded as the `depsherpa-report` artifact.

### Manual runs

Add `workflow_dispatch` inputs to investigate any upgrade against the current branch:

```yaml
on:
  workflow_dispatch:
    inputs:
      package: { description: npm package, required: true }
      version: { description: exact target version, required: true }
# ...
      - uses: cfngc4594/dep-sherpa@main
        with:
          package: ${{ inputs.package }}
          version: ${{ inputs.version }}
```

### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `package` | detected from the PR | npm package to upgrade |
| `version` | detected from the PR | exact target version; ranges and dist-tags are rejected |
| `attempt-repair` | `true` | allow a recipe or the configured model to propose a bounded repair, validated and verified inside the clone |
| `comment` | `true` | create or update one PR comment (needs `pull-requests: write`) |
| `model` | `gpt-4.1-mini` | model identifier sent to the endpoint |
| `openai-api-key` | empty | API key from a secret; enables model proposals |
| `openai-base-url` | `https://api.openai.com/v1` | any OpenAI-compatible endpoint (OpenAI, Azure OpenAI v1, OpenRouter, self-hosted) |
| `github-token` | `${{ github.token }}` | used only for the comment |
| `report-dir` | `depsherpa-report` | where report files are written and uploaded from |

Outputs: `verdict` (`ready_for_review`, `repaired_ready_for_review`, `needs_repair`, `inconclusive`, `blocked`, or `skipped`), `repair-status`, `report-dir`.

### Model configuration

The model is only asked for a proposal when the upgrade introduces a failure that no recipe covers. It receives a bounded packet — diagnostics, exact source excerpts, the manifest, declared checks, policy limits, and installed-package version evidence — and can only answer with structured data. Deterministic policy decides whether that data may be applied inside the clone.

- **Any OpenAI-compatible endpoint:** pass `openai-api-key` (from a repository secret) and optionally `openai-base-url` and `model`; most hosted and self-hosted providers speak this format. Locally, set `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `DEPSHERPA_MODEL`.
- **No model:** the report records `agent_unavailable`, keeps the diagnostics and source context for a human, and applies nothing. Recipes such as the Zod 3→4 `ZodError.errors → .issues` migration still run.
- **Why no zero-configuration option:** GitHub Models — the `GITHUB_TOKEN`-authenticated inference GitHub Actions used to offer — was retired on 2026-07-30 and its endpoint answers HTTP 410. DepSherpa therefore never treats the workflow token as a model credential.

## What the report contains

| Stage | Evidence |
| --- | --- |
| Inventory | `package.json` plus the exact lockfile baseline |
| Isolated change | Disposable clone of the base commit; source repository untouched |
| Diagnosis | Baseline vs candidate checks; introduced failures separated from pre-existing ones; first actionable diagnostic retained |
| Repair | A recipe or the model emits a structured candidate; deterministic policy alone may apply it in the clone |
| Verification | Every declared check reruns after the repair; unexpected file changes are audited |
| Gate | Human review. `verified` describes observed checks, not correctness; nothing is applied, committed, or pushed |

Rejecting or ignoring the packet has no effect on the repository.

## Security boundaries

- The Action runs on your runner and executes your repository's own `npm ci` and declared scripts inside a clone of your own commit — the same trust you already extend to CI. It is a disposable-clone workflow, not an operating-system sandbox.
- The only GitHub write is one PR comment. There is no code path that commits, pushes, opens a pull request, or applies a patch to the checkout.
- Isolated installs run with npm lifecycle scripts disabled; the clone's `origin` is removed before repository code runs.
- Repair is capped at three tracked source files and twelve changed lines. Tests, fixtures, migrations, configuration, traversal paths, untracked files, unread context, ambiguous matches, and suppressions or process/network/filesystem capabilities in replacements are rejected.
- The model has no tools. It sees a bounded, untrusted evidence packet and answers with JSON that is schema-validated and then policy-validated. Missing or failing model access degrades to `agent_unavailable`, never to an unvalidated edit.
- `github-token` is used only for the comment; `openai-api-key` is only ever sent to the endpoint you configured. Neither reaches the report.

See [SECURITY.md](SECURITY.md) for the full mutation policy.

## Run it locally (CLI)

The Action is a thin wrapper around the same core, so everything can be reproduced on a laptop with Node.js 22.13+, Git, and npm:

```bash
npm install
npm run depsherpa -- inspect /path/to/repo zod 4.1.5            # dry run: classify the jump, discover checks
npm run depsherpa -- upgrade /path/to/npm-repo zod 4.1.5         # isolated upgrade, baseline vs candidate
npm run depsherpa -- upgrade /path/to/npm-repo zod 4.1.5 --attempt-repair --json
npm run demo:repair                                              # complete Zod 3→4 repair packet, no credentials needed
```

`upgrade` requires an npm repository whose path is the Git root and whose `package-lock.json` is committed. Use `--keep-workspace` only to inspect the disposable clone manually. Set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL`, `DEPSHERPA_MODEL`) to enable model proposals locally.

The generic, non-recipe closed loop is covered by a test that injects a structured model proposal and exercises policy, isolated application, and verification without any network:

```bash
npm test -- --run src/core/repair.test.ts -t "validates, applies, and verifies a non-recipe Agent proposal"
```

## Development

The repository follows the [`actions/typescript-action`](https://github.com/actions/typescript-action) layout: a Node 24 action whose entry point is the committed bundle `dist/index.js`, built with Rollup from `src/index.ts`.

```bash
npm install
npm run all          # format, lint, typecheck, test with coverage, badge, bundle
npm run bundle       # format + rebuild dist/ (commit the result; check-dist.yml enforces it)
npm run local-action # run src/main.ts locally with the INPUT_* values from .env (see .env.example)
```

Individual steps: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (Jest, ESM), `npm run package`.

The suites cover the deterministic core (major/minor/patch/peer/dev/optional/missing/invalid cases and report invariants), the bounded repair policy, the OpenAI-compatible generator (strict schema, fallback, failure modes, configuration resolution), the Action orchestration (input validation, PR detection, shallow-checkout base preparation, summary/outputs/report files, comment create/update), and `src/main.ts` wiring against mocked `@actions/*` modules.

Releases follow the template's tag convention: `script/release` creates `vX.Y.Z` and moves the major tag (`v1`) so workflows can pin `uses: cfngc4594/dep-sherpa@v1`.

## Repository map

```text
action.yml                action metadata (runs: node24, main: dist/index.js)
dist/                     bundled action (committed; rebuilt with npm run package)
src/index.ts              entry point
src/main.ts               @actions/core, @actions/github, @actions/artifact wiring
src/action/               orchestration: inputs, PR detection, base checkout, comment
src/agent/openai.ts       OpenAI-compatible proposal generator (no tools)
src/core/                 deterministic core: analysis, isolated runner, repair policy, reports
__tests__/, __fixtures__/ Jest suites and shared fixtures
scripts/depsherpa.ts      command-line entry point (same core)
scripts/demo-repair.ts    isolated Zod repair demonstration
script/release            tag and push a release
.github/workflows/        ci, check-dist, codeql, and this repository's own DepSherpa run
fixtures/                 synthetic repositories used by the demo and tests
docs/                     architecture and Devpost copy
```

## Current boundaries

- npm-compatible JavaScript/TypeScript projects only; the repository root must contain `package.json` and a committed `package-lock.json`.
- One dependency per pull request. Grouped Dependabot/Renovate updates are reported as skipped; pass `package` and `version` explicitly to investigate one of them.
- Workflows triggered by Dependabot receive a read-only `GITHUB_TOKEN`; the summary and artifact are still produced, and the comment reports as failed unless you grant write access through a different token.
- Every npm upgrade can enter the investigation and controlled-proposal flow. That does not mean every failure can be repaired: the model may be unavailable or abstain, evidence may be insufficient, policy may reject a proposal, and verification may fail.
- No branch push, pull request creation, messaging, or other external write occurs.

## License

[MIT](LICENSE). Copyright (c) 2026 cfngc4594.
