import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  applicationRoot,
  loadConfig,
  loadNetworkConfig,
  type RuntimeConfig,
} from './config.js';
export interface ServerRuntime extends RuntimeConfig {
  demoMode: boolean;
  cleanup(): void;
}
function outsideCheckout(path: string): boolean {
  const part = relative(realpathSync(applicationRoot), path);
  return part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part);
}
export function prepareServerRuntime(
  environment: Record<string, string | undefined> = process.env,
): ServerRuntime {
  const flag = environment.LEAF_DEMO_MODE;
  if (flag !== undefined && flag !== '0' && flag !== '1')
    throw new Error('Invalid LEAF_DEMO_MODE');
  if (flag !== '1')
    return { ...loadConfig(environment), demoMode: false, cleanup() {} };
  // Do not inspect LEAF_DATA_DIR, even when it is explicitly supplied.
  let origin = environment.LEAF_PUBLIC_ORIGIN;
  if (environment.RENDER === 'true' && origin === undefined) {
    const hostname = environment.RENDER_EXTERNAL_HOSTNAME;
    if (
      !hostname ||
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.onrender\.com$/.test(
        hostname,
      )
    )
      throw new Error('Invalid Render hostname');
    origin = `https://${hostname.toLowerCase()}`;
  }
  const network = loadNetworkConfig({
    ...environment,
    ...(origin !== undefined ? { LEAF_PUBLIC_ORIGIN: origin } : {}),
  });
  if (
    environment.RENDER === 'true' &&
    new URL(network.publicOrigin).protocol !== 'https:'
  )
    throw new Error('Render requires HTTPS origin');
  // A hostile TMPDIR cannot turn temporary runtime files into checkout writes.
  const candidate = realpathSync(tmpdir());
  const tempRoot = outsideCheckout(candidate)
    ? candidate
    : realpathSync('/tmp');
  if (!outsideCheckout(tempRoot))
    throw new Error('Temporary directory must be outside checkout');
  const directory = mkdtempSync(join(tempRoot, 'leaf-demo-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    return {
      ...loadConfig({
        ...environment,
        LEAF_DATA_DIR: directory,
        LEAF_PUBLIC_ORIGIN: network.publicOrigin,
      }),
      demoMode: true,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
