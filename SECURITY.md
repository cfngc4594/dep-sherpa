# Security policy

## Current safety model

DepSherpa treats source changes and external writes as separate capabilities. The current release provides neither capability to the model, and the only external write any entry point performs is one pull-request comment from the GitHub Action.

- Manifest inspection is read-only.
- Project checks are opt-in at the CLI. DepSherpa spawns npm without a shell, but npm runs the repository's declared scripts with normal npm semantics; operators must trust those scripts because this release does not provide an operating-system network or filesystem sandbox.
- The `upgrade` core accepts only an npm Git-root path with a committed `package-lock.json`, clones the committed `HEAD` into an operating-system temporary directory, removes the clone's source `origin` before running project code, excludes uncommitted source changes, and removes caller-directory hints from child-process environments.
- Dependency preparation and upgrade commands run with npm lifecycle scripts disabled.
- Before repair, the candidate patch is limited to `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`; it is reported but never copied back automatically.
- `--attempt-repair` allows only tracked `.ts`, `.tsx`, `.js`, and `.jsx` files, with a maximum of three files and twelve changed source lines. Tests, fixtures, migrations, configuration, untracked diagnostic paths, and unattributed edits are rejected.
- Recipe generators and the model produce the same `RepairProposal` data: normalized relative path, exact expected text, replacement, rationale, and exact supporting diagnostic. A proposal conveys no execution authority.
- Deterministic validation rejects absolute paths, traversal, symlinks, binary or invalid UTF-8 content, unsupported extensions, more than three files or twelve lines, overlapping edits, context not supplied to the model, stale text, text that does not occur exactly once, and replacements that introduce common type-check suppressions or process/network/filesystem capabilities.
- The Zod recipe remains as a fast proposal generator, but it passes through the same proposal validation and verification path as model-generated candidates.
- The repair patch is captured before verification and compared again afterward. A check that alters the proposed patch prevents verified status.
- Diagnostic command output is bounded. The final Git diff is captured in full for review.
- Every command has a timeout.
- No DepSherpa code path pushes a branch, creates a pull request, applies a patch to a checkout, or sends a message other than the report comment. Repository-owned check scripts remain capable of their own side effects and are outside that guarantee.

## Model access

- Proposals are requested from an OpenAI-compatible `chat/completions` endpoint through the official `openai` SDK. `OPENAI_API_KEY` (plus optional `OPENAI_BASE_URL` and `DEPSHERPA_MODEL`) selects the endpoint; without it no request is made. The GitHub Actions token is never used as a model credential (GitHub Models was retired on 2026-07-30).
- The model is instantiated with no tools. It receives only bounded diagnostics, exact source excerpts, the manifest, declared check metadata, policy limits, and bounded target-package version/migration evidence; all of it is treated as untrusted data, and the system prompt instructs the model to ignore instructions embedded in it.
- The response is constrained with a strict JSON schema (falling back to `json_object` for endpoints that reject it), parsed, validated with Zod, and then validated again by the deterministic repair policy. Missing credentials, HTTP failures, malformed output, or abstention become `agent_unavailable`, `unsupported`, or `no_proposal`; no edit is ever applied from an unvalidated answer.
- API keys are read from the environment or Action inputs only. They are never written into reports, summaries, comments, or artifacts.

## GitHub Action

- The Action runs entirely on the workflow's runner as a JavaScript action from the committed bundle `dist/index.js`; it installs nothing at run time and `check-dist.yml` verifies that the bundle matches the source. It executes the repository's own `npm ci` and declared scripts inside a disposable clone of the pull request's **base** commit, so a PR cannot make the Action run code that the base branch does not already contain. Reviewers still own the trust decision for scripts in their own repository, as with any CI job.
- Inputs are `package`, `version`, `attempt-repair`, `comment`, `upload-artifact`, `report-dir`, model settings, and `github-token`. There is no input for commands, scripts, executables, or environment variables; `package` must be a valid npm name and `version` an exact semantic version. Detection from a pull request only reads `package.json` at the base and head commits. `openai-api-key` is registered as a secret with the runner so it is masked in logs.
- Required permissions: `contents: read`. Optional: `pull-requests: write` for the single report comment (created once, then updated in place). Nothing else is requested.
- The base commit is fetched by SHA when the checkout is shallow, checked out into a temporary directory through a short-lived local branch that is deleted afterwards, and the temporary directory is removed when the run ends. The workspace is otherwise left as `actions/checkout` produced it, plus the `report-dir` files.
- The Action never fails a workflow because of a verdict; it only fails on invalid inputs or infrastructure errors, so it cannot be used as an automatic merge gate by accident. Consumers may build their own gate from the `verdict` output.

## Reporting a vulnerability

Please open a private GitHub security advisory once the public repository is available. Do not include credentials, private source code, or production logs in a public issue.

## External mutation policy

Model-proposed repairs pass through the deterministic policy engine, stay inside the disposable clone, show a complete diff, and stop at a human decision. If patch application, commits, or pull-request creation are added later, they must require a separate, explicitly scoped approval capability that is not available to the model.
