import { hostedLocalCapabilities } from '@/src/harness/hosted';

/**
 * Tells the browser why local execution is unavailable in this deployment.
 * The dev harness middleware replaces this answer when it is attached.
 */
export async function GET(): Promise<Response> {
  return hostedLocalCapabilities();
}
