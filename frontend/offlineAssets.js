import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function offlineAssetManifest({ enabled = false } = {}) {
    return {
        name: 'offline-asset-manifest',
        generateBundle(_options, bundle) {
            const chunks = Object.entries(bundle).filter(([, file]) => file.type === 'chunk');
            const entries = chunks.filter(([, file]) => file.isEntry);
            const attendance = chunks.filter(([, file]) => /\/src\/(?:pages\/Scanner|components\/OfflineAttendanceTerminal)\.jsx$/.test(file.facadeModuleId?.replace(/\\/g, '/') || ''));
            if (!entries.length || attendance.length !== 2) throw new Error('Offline application entry or attendance routes are missing from the build.');
            const required = new Set();
            const visit = name => {
                if (required.has(name)) return;
                const file = bundle[name];
                if (!file) throw new Error(`Offline dependency is missing from the build: ${name}`);
                required.add(name);
                if (file.type !== 'chunk') return;
                // The app entry lists every lazy route, including online-only payroll and personnel screens.
                for (const dependency of [...file.imports, ...(file.isEntry ? [] : file.dynamicImports)]) visit(dependency);
            };
            for (const [name] of [...entries, ...attendance]) visit(name);
            // Keep styles and their font/image dependencies available without relying on Vite's private CSS metadata.
            const assets = Object.keys(bundle).filter(name => required.has(name) || name.startsWith('assets/blink-') || /\.(?:css|woff2?|ttf|png|svg)$/.test(name)).map(name => `/${name}`);
            this.emitFile({ type: 'asset', fileName: 'offline-assets.json', source: JSON.stringify({ schema_version: 1, assets }) });
            const template = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8').replace('const OFFLINE_BUILD_ENABLED = false;', `const OFFLINE_BUILD_ENABLED = ${enabled};`);
            const version = createHash('sha256').update(JSON.stringify(assets)).update(template).digest('hex').slice(0, 16);
            const worker = template.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'offline-${version}';`);
            this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
        },
    };
}
