import { hostedLocalExecutionRejection } from '@/src/harness/hosted';

/**
 * Hosted deployments never execute repository code. During `npm run dev` the
 * Node harness middleware answers this path before the application does; in
 * every other environment this handler is the only thing that exists here and
 * it always rejects. It deliberately imports nothing from the execution core.
 */
export async function POST(): Promise<Response> {
  return hostedLocalExecutionRejection();
}
