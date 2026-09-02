# DepSherpa

DepSherpa is an evidence-first agent for dependency upgrades. It turns a version bump into a change-control packet: what changes, why it is risky, which repository checks exist, what actually ran, and which human decision is still required.

The project is being built for the **Agents for Humans Hackathon — Professional Agents track**. It uses the [Strands Agents TypeScript SDK](https://strandsagents.com/) for model-driven orchestration while keeping a credential-free deterministic path for judging and local development.

## Why this is different

Most dependency bots stop after changing a version. DepSherpa separates six responsibilities and records evidence for each one:

1. inventory the repository;
2. retain relevant release evidence;
3. prepare an isolated upgrade;
4. diagnose the repository's own failures;
5. propose a bounded repair;
6. verify and wait for explicit human approval.

No GitHub write access is implemented in this version. The web workspace clearly separates live read-only metadata from synthetic execution. The local CLI can apply a candidate upgrade only inside a disposable clone of the repository's committed state.

## Use the hosted inspector

The web workspace has two deliberately separate paths:

- **Live read-only evidence** accepts a public GitHub repository URL, a `package.json` path, an npm dependency, and an exact target version. It reads the manifest through the GitHub API, confirms the target through npm, matches up to six GitHub Releases from the package's declared source repository, discovers repository checks, and produces a copyable JSON report.
- **Deterministic demo** replays the complete Zod migration story, including a simulated failure, bounded repair, verification, and local approval gate.

The hosted path never clones a repository, installs packages, executes project scripts, changes source, or writes to GitHub. Private repositories are intentionally unsupported until an explicit authentication design is approved.

## Run the workspace locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the command. Use the public-repository form for real metadata or press **Run investigation** in the synthetic packet to inspect the complete staged workflow.

## Inspect a real repository

The dry-run command reads `package.json`, classifies the requested version jump, discovers standard verification scripts, and prints a Markdown report:

```bash
npm run depsherpa -- inspect /path/to/repo zod 4.1.5
```

Execute only the repository's already-declared `lint`, `typecheck`, `test`, and `build` scripts:

```bash
npm run depsherpa -- inspect /path/to/repo zod 4.1.5 --run-checks
```

Machine-readable output:

```bash
npm run depsherpa -- inspect /path/to/repo zod 4.1.5 --json
```

## Run an upgrade in isolation

The isolated runner copies the repository's committed `HEAD` into a disposable directory, installs dependencies with lifecycle scripts disabled, records a baseline, applies the exact target, and reruns the declared checks. It returns the manifest/lockfile patch, distinguishes newly introduced failures from failures that already existed, and retains the first actionable diagnostic with a check-specific next step:

```bash
npm run depsherpa -- upgrade /path/to/npm-repo zod 4.1.5
```

Add `--attempt-repair` to authorize a policy-bounded repair inside the disposable clone. The first recipe handles the documented Zod 3→4 `ZodError.errors` to `.issues` migration only when TypeScript identifies the exact tracked source line. It may change at most three source files and twelve source lines, rejects tests, fixtures, migrations, configuration, untracked paths, and unexplained edits, then reruns every declared check:

```bash
npm run depsherpa -- upgrade /path/to/npm-repo zod 4.1.5 --attempt-repair
```

Use `--json` for a machine-readable decision packet. Use `--keep-workspace` only when you need to inspect the disposable checkout manually. Uncommitted source changes are listed in the report but intentionally excluded from the clone.

The first isolated-runner release requires an npm repository whose supplied path is the Git root and whose `package-lock.json` is committed. It never commits, pushes, opens a pull request, or copies the patch back to the source repository. npm executes the repository's declared checks normally, so use it only with code and scripts you trust; this release does not provide an operating-system sandbox.

Reproduce the complete Zod failure, one-line repair, and green verification packet with:

```bash
npm run demo:repair
```

## Run with Strands Agents

Strands uses Amazon Bedrock by default. Configure the standard AWS credential chain and model access, then run:

```bash
npm run depsherpa -- agent /path/to/repo zod 4.1.5
```

The agent receives three intentionally read-only tools: `inspect_manifest`, `inspect_project_checks`, and `inspect_repair_policy`. Command execution, file mutation, and external writes are not available directly to the model; deterministic CLI policy owns any repair inside the disposable clone.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The evaluation suite covers major, minor, patch, peer, dev, optional, missing, and invalid dependency cases, plus report safety invariants.

## Repository map

```text
app/                    interactive web demonstration
app/api/investigate/    read-only GitHub and npm evidence endpoint
scripts/depsherpa.ts    command-line entry point
src/agent/              Strands orchestration adapter
src/core/               local and remote analysis, check runner, report generation
src/evals/              deterministic evaluation scenarios
fixtures/               synthetic judging fixture
docs/ARCHITECTURE.md    system diagram and trust boundaries
```

## Current boundaries

- npm-compatible JavaScript/TypeScript projects only.
- Version classification uses semantic-version ranges; exotic protocols are reported as unknown.
- The hosted inspector reads only public repositories and uses unauthenticated upstream APIs, so normal GitHub and npm rate limits apply.
- Exact npm version verification, semver-range GitHub Release matching, isolated npm upgrades, and one compiler-attributed Zod migration repair are live. Repository changelog fallback and model-proposed general repairs remain future work.
- No branch push, pull request creation, messaging, or other external write occurs.

See [SECURITY.md](SECURITY.md) for the mutation policy and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the orchestration design.

## License

MIT
