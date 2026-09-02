# Security policy

## Current safety model

DepSherpa treats source changes and external writes as separate capabilities. The current release provides neither capability to the model.

- Manifest inspection is read-only.
- Project checks are opt-in at the CLI. DepSherpa spawns npm without a shell, but npm runs the repository's declared scripts with normal npm semantics; operators must trust those scripts because this release does not provide an operating-system network or filesystem sandbox.
- The `upgrade` command accepts only an npm Git-root path with a committed `package-lock.json`, clones the committed `HEAD` into an operating-system temporary directory, and excludes uncommitted source changes.
- Dependency preparation and upgrade commands run with npm lifecycle scripts disabled.
- The candidate patch is limited to `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`; it is reported but never copied back automatically.
- `--attempt-repair` allows only tracked `.ts`, `.tsx`, `.js`, and `.jsx` files, with a maximum of three files and twelve changed source lines. Tests, fixtures, migrations, configuration, untracked diagnostic paths, and unattributed edits are rejected.
- The first repair recipe requires a TypeScript diagnostic on an exact line in a file that imports Zod. It changes only the diagnosed `.errors` access to `.issues`, then reruns every declared check.
- The repair patch is captured before verification and compared again afterward. A check that alters the proposed patch prevents verified status.
- Captured command output is bounded.
- Every command has a timeout.
- The web inspector can read only public GitHub repository metadata and a selected `package.json`; it cannot access private repositories.
- Hosted inspection calls fixed GitHub and npm HTTPS origins, validates repository and manifest paths, and never executes fetched content.
- Release-note bodies are reduced to bounded plain-text excerpts before they enter the report.
- No token, GitHub credential, or cloud credential is sent to the browser.
- No DepSherpa code path pushes a branch, creates a pull request, or sends a message. Repository-owned check scripts remain capable of their own side effects and are outside that guarantee.

## Reporting a vulnerability

Please open a private GitHub security advisory once the public repository is available. Do not include credentials, private source code, or production logs in a public issue.

## Future mutation policy

Future model-proposed repair recipes must pass through the same deterministic policy engine, stay inside the disposable clone, show a complete diff, and require a one-time human approval token before exporting changes. External writes must use a second, separately scoped approval.
