import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Same-origin, versioned assets avoid third-party camera-time requests and stale worker/model combinations.
export function blinkAssets() {
  const require = createRequire(import.meta.url);
  const runtime = dirname(require.resolve('@mediapipe/tasks-vision'));
  const model = readFileSync(new URL('./src/assets/face-landmarker-v1.task', import.meta.url));
  if (createHash('sha256').update(model).digest('hex') !== '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff') throw new Error('Blink model integrity check failed.');
  const files = new Map([
    ['blink.worker.js', buildSync({ entryPoints: [fileURLToPath(new URL('./src/utils/blink.worker.mjs', import.meta.url))], bundle: true, format: 'iife', platform: 'browser', write: false }).outputFiles[0].contents],
    ['vision_bundle.js', readFileSync(join(runtime, 'vision_bundle.cjs'))],
    ['face-landmarker.task', model],
    ['NOTICE.txt', readFileSync(new URL('./src/assets/face-landmarker-NOTICE.txt', import.meta.url))],
    ['LICENSE.txt', readFileSync(new URL('./src/assets/mediapipe-LICENSE.txt', import.meta.url))],
  ]);
  for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) files.set(name, readFileSync(join(runtime, 'wasm', name)));
  const hash = createHash('sha256');
  for (const [name, content] of files) hash.update(name).update(content);
  const base = `/assets/blink-${hash.digest('hex').slice(0, 16)}`;
  return {
    name: 'blink-assets',
    config() { return { define: { 'import.meta.env.BLINK_ASSET_BASE': JSON.stringify(base) } }; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (!path.startsWith(`${base}/`)) return next();
        const name = path.slice(base.length + 1), content = files.get(name);
        if (!content) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(content);
      });
    },
    generateBundle() {
      for (const [name, source] of files) this.emitFile({ type: 'asset', fileName: `${base.slice(1)}/${name}`, source });
    },
  };
}
