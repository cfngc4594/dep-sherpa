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

No GitHub write access is implemented in this version. The web workspace clearly separates live read-only metadata from synthetic execution; the CLI is read-only unless the operator explicitly enables project checks.

## Use the hosted inspector

The web workspace has two deliberately separate paths:

- **Live read-only evidence** accepts a public GitHub repository URL, a `package.json` path, an npm dependency, and an exact target version. It reads the manifest through the GitHub API, confirms the target through npm, classifies the version jump, discovers repository checks, and produces a copyable JSON report.
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

## Run with Strands Agents

Strands uses Amazon Bedrock by default. Configure the standard AWS credential chain and model access, then run:

```bash
npm run depsherpa -- agent /path/to/repo zod 4.1.5
```

The agent receives two intentionally read-only tools: `inspect_manifest` and `inspect_project_checks`. Command execution, file mutation, and external writes are not available to the model in this first safety boundary.

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
- Exact npm version verification is live; changelog extraction and isolated patch application remain future work.
- No branch push, pull request creation, messaging, or other external write occurs.

See [SECURITY.md](SECURITY.md) for the mutation policy and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the orchestration design.

## License

MIT
