import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { analyzeUpgrade, listChecks, readManifest } from '../core/manifest';
import { getRepairCapabilities } from '../core/repair';

export function createDepSherpaAgent(repoPath: string): Agent {
  const inspectManifest = tool({
    name: 'inspect_manifest',
    description: 'Read package.json and assess one proposed dependency target without changing files.',
    inputSchema: z.object({
      packageName: z.string().min(1),
      targetVersion: z.string().min(1),
    }),
    callback: async ({ packageName, targetVersion }) => {
      const { manifest } = await readManifest(repoPath);
      return JSON.stringify(analyzeUpgrade(manifest, packageName, targetVersion));
    },
  });

  const inspectChecks = tool({
    name: 'inspect_project_checks',
    description: 'List the repository scripts DepSherpa may run for verification. This tool never executes them.',
    inputSchema: z.object({}),
    callback: async () => {
      const { manifest } = await readManifest(repoPath);
      return JSON.stringify(listChecks(manifest));
    },
  });

  const inspectRepairPolicy = tool({
    name: 'inspect_repair_policy',
    description: 'Describe the deterministic repair policy and shipped recipes without changing files.',
    inputSchema: z.object({}),
    callback: () => JSON.stringify(getRepairCapabilities()),
  });

  return new Agent({
    systemPrompt: `You are DepSherpa, an evidence-first dependency upgrade investigator.
Use tools before reaching a conclusion. Distinguish observed facts from hypotheses.
Never claim that a command ran unless a tool result proves it. Never write files,
push branches, create pull requests, or contact people. A repair is eligible only
when the deterministic policy reports a matching recipe. Finish with: risk, evidence,
recommended verification, and the explicit human decision still required.`,
    tools: [inspectManifest, inspectChecks, inspectRepairPolicy],
  });
}

export async function investigateWithStrands(
  repoPath: string,
  packageName: string,
  targetVersion: string,
): Promise<string> {
  const agent = createDepSherpaAgent(repoPath);
  const result = await agent.invoke(
    `Investigate upgrading ${packageName} to ${targetVersion}. Prepare a concise change-control brief.`,
  );
  return String(result);
}
