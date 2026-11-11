import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

export const objectFile = (bucket, key) => `storage/${createHash('sha256').update(JSON.stringify([bucket, key])).digest('hex')}.bin`;
export const inventoryFingerprint = rows => createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');
export const inside = (root, candidate) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

export async function hashFile(filename) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(filename)) hash.update(bytes);
    return { bytes: (await stat(filename)).size, sha256: hash.digest('hex') };
}

export async function exportStorage(root, objects, download) {
    await mkdir(path.join(root, 'storage'), { recursive: true, mode: 0o700 });
    const files = [];
    for (const object of objects) {
        const file = objectFile(object.bucket_id, object.name);
        const response = await download(object);
        if (!response.ok || !response.body) throw new Error('Storage download failed; backup is incomplete.');
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, done) {
            bytes += chunk.length;
            done(bytes > 256 * 1024 * 1024 ? new Error('Storage object exceeds the 256 MB backup limit.') : null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(path.join(root, file), { flags: 'wx', mode: 0o600 }));
        const expected = object.metadata?.size;
        if (expected != null && Number(expected) !== bytes) throw new Error('Storage object size changed; retry during a quiet window.');
        files.push({ file, bucket: object.bucket_id, key: object.name, metadata: object.metadata, ...await hashFile(path.join(root, file)) });
    }
    return files;
}

export async function verifyFiles(root, files) {
    const canonicalRoot = await realpath(root);
    const seen = new Set();
    for (const entry of files) {
        if (typeof entry.file !== 'string' || path.isAbsolute(entry.file) || !inside(root, path.join(root, entry.file)) || seen.has(entry.file)) throw new Error('Invalid backup manifest path.');
        seen.add(entry.file);
        const filename = await realpath(path.join(root, entry.file));
        if (!inside(canonicalRoot, filename)) throw new Error('Backup path leaves its restore directory.');
        const actual = await hashFile(filename);
        if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error('Backup file integrity verification failed.');
    }
}

export async function validateDumps(root, tables = ['public.employees', 'public.payrolls', 'auth.users', 'storage.buckets', 'storage.objects']) {
    let schema;
    try {
        const roles = await readFile(path.join(root, 'roles.sql'), 'utf8');
        schema = await readFile(path.join(root, 'schema.sql'), 'utf8');
        if (roles.length < 20 || schema.length < 20 || (await stat(path.join(root, 'data.sql'))).size < 20) throw new Error();
    } catch { throw new Error('Database dump files are missing or empty.'); }
    const covered = new Set();
    for await (const line of createInterface({ input: createReadStream(path.join(root, 'data.sql')), crlfDelay: Infinity })) {
        const match = line.replaceAll('"', '').match(/^COPY\s+(\S+)\s+\(/);
        if (match) covered.add(match[1]);
    }
    for (const table of tables) {
        if (!covered.has(table)) throw new Error('Database dump coverage is incomplete; expected table data is missing.');
    }
    if (!/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.employees\s*\(/i.test(schema.replaceAll('"', ''))) throw new Error('Database schema coverage is incomplete.');
}

async function resolvedLocation(value) {
    try { return await realpath(value); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(path.resolve(value));
        if (parent === path.resolve(value)) throw error;
        return path.join(await resolvedLocation(parent), path.basename(value));
    }
}

export async function assertSeparated(target, protectedPaths) {
    if (!path.isAbsolute(target)) throw new Error('Restore target must be an absolute isolated path.');
    const resolved = await resolvedLocation(target);
    for (const protectedPath of protectedPaths.filter(Boolean)) {
        const protectedResolved = await resolvedLocation(protectedPath);
        if (inside(protectedResolved, resolved) || inside(resolved, protectedResolved)) throw new Error('Restore target overlaps the source or backup repository.');
    }
}

export async function assertRestoreTarget(target, { source, repository, state }) {
    await assertSeparated(target, [source, repository, state]);
    try { if ((await readdir(target)).length) throw new Error('Restore target must be empty.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function assertSafeArchive(entries, types) {
    if (entries.some(entry => entry.includes('\\') || entry.includes(':') || path.isAbsolute(entry) || entry.split('/').includes('..'))) throw new Error('Unsafe archive path. Nothing was extracted.');
    if (types.some(line => !['-', 'd'].includes(line[0]))) throw new Error('Unexpected archive link or device. Nothing was extracted.');
}
