import { hostedLocalExecutionRejection } from '@/src/harness/hosted';

/** Hosted deployments cannot read a local filesystem; see ../upgrade/route.ts. */
export async function POST(): Promise<Response> {
  return hostedLocalExecutionRejection();
}
