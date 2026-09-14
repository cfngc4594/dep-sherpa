# Devpost draft

Paste these blocks into Devpost. They describe the shipped repository, not future work.

## Project name

DepSherpa

## Tagline

An evidence-first dependency upgrade agent that investigates in isolation and stops at a human approval gate.

## Project intro

DepSherpa turns one JavaScript/TypeScript dependency bump into a reviewable change-control packet. It ships as a GitHub Action: when Dependabot or Renovate opens a PR, it checks out the base commit into a disposable clone on the repository's own runner, applies the exact target, runs the project's own checks before and after, may propose and verify one bounded source repair, and reports back as a job summary, an artifact, and one PR comment. The result is a verdict, a bounded patch, and an explicit human decision — not an automatic commit or merge.

Model proposals use the official `openai` SDK against any OpenAI-compatible endpoint configured through one repository secret; without it the Action still produces the full report and runs the deterministic recipes. The model has no tools and can only answer with schema-validated data. Command execution, source edits, and any repair stay in deterministic policy. The Action's only write is its report comment.

Judges can reproduce the isolated upgrade and the complete Zod repair without any credentials, and the GitHub Action path is covered by tests against a shallow pull request checkout.

## Built With

- GitHub Actions
- openai (official SDK, any OpenAI-compatible endpoint)
- TypeScript
- Node.js 22
- Zod
- npm
- Git
- GitHub REST API
- npm registry
- Vitest

## How to evaluate

Requirements: Node.js 22.13 or newer, Git, and npm. No model credentials are required for judging.

```bash
git clone https://github.com/cfngc4594/dep-sherpa.git
cd dep-sherpa
npm install
npm run typecheck
npm test
npm run lint
```

Then exercise the public paths:

1. **GitHub Action**  
   Add the workflow from the README to any npm repository and open a pull request that bumps one dependency in `package.json`; the PR receives the report comment and the run uploads the `depsherpa-report` artifact. Locally, `npm test -- --run src/action` runs the same orchestration against a shallow Dependabot-style checkout.

2. **Isolated upgrade + deterministic repair**  
   `npm run demo:repair`  
   Expect a disposable clone, a Zod 3→4 typecheck failure, a one-line `.errors` → `.issues` repair, green verification, and `repaired_ready_for_review`. The source fixture is not modified.

3. **Local inspect on this repo**  
   `npm run depsherpa -- inspect . zod 4.1.5`  
   Confirm the Markdown packet names the version jump, discovered checks, and the human gate.

Optional: set `OPENAI_API_KEY` (and `OPENAI_BASE_URL` for a compatible provider) before `upgrade --attempt-repair` to see a model proposal for a failure no recipe covers. The model cannot write files.

What to look for: an evidence chain, isolation before mutation, a three-file / twelve-line repair cap, and a human decision that the Action cannot take for you. What not to expect: a commit, a push, an automatic merge, or a general auto-fixer.

## License

MIT. See [LICENSE](../LICENSE).
