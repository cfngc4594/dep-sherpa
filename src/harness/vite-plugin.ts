import type { Plugin } from 'vite';
import { localApiBasePath } from './contracts';
import { isHarnessFlagDisabled } from './gate';
import { createLocalHarnessMiddleware } from './node-http';
import { createLocalHarnessHandler } from './runtime';

/**
 * Dev-server-only harness.
 *
 * `vinext dev` serves the Next.js application through the Cloudflare Workers
 * emulator, which cannot spawn processes or read the developer's disk. The
 * Vite dev server itself, however, is an ordinary Node process on the
 * developer's machine. This plugin attaches the local API there, in front of
 * the Worker, so `POST /api/local/upgrade` reaches the same deterministic core
 * the CLI uses.
 *
 * `apply: 'serve'` means the plugin does not exist during `vinext build`; the
 * deployed Worker only ever contains the hosted rejection routes.
 */
export function depSherpaLocalHarness(): Plugin {
  return {
    name: 'depsherpa:local-harness',
    apply: 'serve',
    configureServer(server) {
      const env = process.env;
      const handler = createLocalHarnessHandler({ env, projectRoot: server.config.root });
      const secure = Boolean(server.config.server.https);
      server.middlewares.use(createLocalHarnessMiddleware(handler, { secure }));
      const status = isHarnessFlagDisabled(env.DEPSHERPA_LOCAL_HARNESS)
        ? 'disabled by DEPSHERPA_LOCAL_HARNESS'
        : env.NODE_ENV === 'production'
          ? 'disabled because NODE_ENV=production'
          : 'loopback only · disposable clone · no source-repository writes';
      server.config.logger.info(`DepSherpa local harness: ${localApiBasePath} (${status})`);
    },
  };
}
