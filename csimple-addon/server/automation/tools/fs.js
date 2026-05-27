/**
 * Filesystem tools: fs_read, fs_write, fs_list.
 *
 * All paths must resolve inside one of `permissions.fsRoots` (or the user's
 * home dir if none configured). No symlink following past sandbox roots.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const permissions = require('../permissions');

const MAX_READ_BYTES = 1024 * 1024;     // 1 MB
const MAX_WRITE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_LIST_ENTRIES = 1000;

function allowedRoots() {
    const cfg = permissions.load();
    return (cfg.fsRoots && cfg.fsRoots.length) ? cfg.fsRoots.map(r => path.resolve(r)) : [path.resolve(os.homedir())];
}

function resolveInsideSandbox(p) {
    if (!p || typeof p !== 'string') throw new Error('path is required');
    const abs = path.resolve(p);
    const roots = allowedRoots();
    let real;
    try { real = fs.realpathSync(path.dirname(abs)); }
    catch { real = path.dirname(abs); }
    const realAbs = path.join(real, path.basename(abs));
    if (!roots.some(r => realAbs === r || realAbs.startsWith(r + path.sep))) {
        throw new Error(`path outside sandbox: ${realAbs}. Allowed roots: ${roots.join(', ')}`);
    }
    return realAbs;
}

const fsRead = {
    name: 'fs_read',
    category: 'safe-read',
    description: 'Read a UTF-8 text file from the user\'s sandboxed workspace. Max 1 MB.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path inside an allowed root.' },
            encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Default utf-8.' },
        },
        required: ['path'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        const stat = fs.statSync(abs);
        if (!stat.isFile()) throw new Error('not a regular file');
        if (stat.size > MAX_READ_BYTES) throw new Error(`file too large (${stat.size} > ${MAX_READ_BYTES})`);
        const enc = args.encoding === 'base64' ? 'base64' : 'utf-8';
        const content = fs.readFileSync(abs, enc);
        return { path: abs, size: stat.size, encoding: enc, content };
    },
};

const fsWrite = {
    name: 'fs_write',
    category: 'sandboxed-write',
    description: 'Write a UTF-8 text file inside the user\'s sandboxed workspace. Creates parent dirs.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path inside an allowed root.' },
            content: { type: 'string' },
            encoding: { type: 'string', enum: ['utf-8', 'base64'] },
            mode: { type: 'string', enum: ['overwrite', 'append', 'create-new'], description: 'Default overwrite.' },
        },
        required: ['path', 'content'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        const enc = args.encoding === 'base64' ? 'base64' : 'utf-8';
        const buf = enc === 'base64' ? Buffer.from(args.content, 'base64') : Buffer.from(args.content, 'utf-8');
        if (buf.length > MAX_WRITE_BYTES) throw new Error(`content too large (${buf.length} > ${MAX_WRITE_BYTES})`);
        const mode = args.mode || 'overwrite';
        if (mode === 'create-new' && fs.existsSync(abs)) throw new Error('file already exists (create-new)');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (mode === 'append') {
            fs.appendFileSync(abs, buf);
        } else {
            fs.writeFileSync(abs, buf);
        }
        return { path: abs, bytes: buf.length, mode };
    },
    async dryRun(args) {
        try { const abs = resolveInsideSandbox(args.path); return { wouldWrite: abs, bytes: Buffer.byteLength(args.content || '', 'utf-8') }; }
        catch (e) { return { blocked: e.message }; }
    },
};

const fsList = {
    name: 'fs_list',
    category: 'safe-read',
    description: 'List directory entries with type + size. Non-recursive.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path inside an allowed root.' },
            glob: { type: 'string', description: 'Optional simple wildcard filter (e.g. *.js).' },
        },
        required: ['path'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        const stat = fs.statSync(abs);
        if (!stat.isDirectory()) throw new Error('not a directory');
        let names = fs.readdirSync(abs);
        if (args.glob) {
            const reSrc = '^' + String(args.glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
            const re = new RegExp(reSrc, 'i');
            names = names.filter(n => re.test(n));
        }
        if (names.length > MAX_LIST_ENTRIES) names = names.slice(0, MAX_LIST_ENTRIES);
        const entries = names.map(n => {
            const p = path.join(abs, n);
            try {
                const s = fs.statSync(p);
                return { name: n, type: s.isDirectory() ? 'dir' : (s.isFile() ? 'file' : 'other'), size: s.size, mtime: s.mtime.toISOString() };
            } catch { return { name: n, type: 'unknown' }; }
        });
        return { path: abs, count: entries.length, entries };
    },
};

module.exports = { fsRead, fsWrite, fsList };
