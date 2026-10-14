import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function offlineAssetManifest({ enabled = false } = {}) {
    return {
        name: 'offline-asset-manifest',
        generateBundle(_options, bundle) {
            const assets = Object.keys(bundle).filter(name => /\.(?:js|css|woff2?|ttf|png|svg)$/.test(name)).map(name => `/${name}`);
            this.emitFile({ type: 'asset', fileName: 'offline-assets.json', source: JSON.stringify({ schema_version: 1, assets }) });
            const template = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8').replace('const OFFLINE_BUILD_ENABLED = false;', `const OFFLINE_BUILD_ENABLED = ${enabled};`);
            const version = createHash('sha256').update(JSON.stringify(assets)).update(template).digest('hex').slice(0, 16);
            const worker = template.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'offline-${version}';`);
            this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
        },
    };
}
