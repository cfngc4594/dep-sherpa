# Security policy

## Current safety model

DepSherpa treats source changes and external writes as separate capabilities. The current release provides neither capability to the model.

- Manifest inspection is read-only.
- Project checks are opt-in at the CLI and run without a shell.
- Captured command output is bounded.
- Every command has a timeout.
- The web inspector can read only public GitHub repository metadata and a selected `package.json`; it cannot access private repositories.
- Hosted inspection calls fixed GitHub and npm HTTPS origins, validates repository and manifest paths, and never executes fetched content.
- Release-note bodies are reduced to bounded plain-text excerpts before they enter the report.
- No token, GitHub credential, or cloud credential is sent to the browser.
- No code path pushes a branch, creates a pull request, or sends a message.

## Reporting a vulnerability

Please open a private GitHub security advisory once the public repository is available. Do not include credentials, private source code, or production logs in a public issue.

## Future mutation policy

Any future patch-application tool must operate inside a disposable worktree, show a complete diff, and require a one-time human approval token. External writes must use a second, separately scoped approval.
