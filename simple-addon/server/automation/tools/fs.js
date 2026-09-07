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

/** Convert a simple wildcard glob (* and ?) into a RegExp (case-insensitive). */
function _globToRegex(glob) {
    const src = '^' + String(glob || '*')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$';
    return new RegExp(src, 'i');
}

const fsMove = {
    name: 'fs_move',
    category: 'sandboxed-write',
    description: 'Move (rename) a file or directory to a new path inside the sandbox. Creates parent dirs of the destination.',
    parameters: {
        type: 'object',
        properties: {
            from: { type: 'string', description: 'Absolute source path.' },
            to: { type: 'string', description: 'Absolute destination path.' },
        },
        required: ['from', 'to'],
    },
    async run(args) {
        const from = resolveInsideSandbox(args.from);
        const to = resolveInsideSandbox(args.to);
        if (path.resolve(from) === path.resolve(to)) return { from, to, moved: false, reason: 'same path' };
        if (!fs.existsSync(from)) throw new Error(`source not found: ${from}`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        return { from, to, moved: true };
    },
    async dryRun(args) {
        try { return { wouldMove: resolveInsideSandbox(args.from), to: resolveInsideSandbox(args.to) }; }
        catch (e) { return { blocked: e.message }; }
    },
};

const fsCopy = {
    name: 'fs_copy',
    category: 'sandboxed-write',
    description: 'Copy a file or directory (recursive) to a new path inside the sandbox. Creates parent dirs.',
    parameters: {
        type: 'object',
        properties: {
            from: { type: 'string', description: 'Absolute source path.' },
            to: { type: 'string', description: 'Absolute destination path.' },
        },
        required: ['from', 'to'],
    },
    async run(args) {
        const from = resolveInsideSandbox(args.from);
        const to = resolveInsideSandbox(args.to);
        if (path.resolve(from) === path.resolve(to)) throw new Error('same path');
        if (!fs.existsSync(from)) throw new Error(`source not found: ${from}`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(from, to, { recursive: true, force: false });
        return { from, to, copied: true };
    },
    async dryRun(args) {
        try { return { wouldCopy: resolveInsideSandbox(args.from), to: resolveInsideSandbox(args.to) }; }
        catch (e) { return { blocked: e.message }; }
    },
};

const fsDelete = {
    name: 'fs_delete',
    category: 'destructive',
    description: 'Delete a file, or a directory when recursive=true. Irreversible — requires destructive permission.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to delete.' },
            recursive: { type: 'boolean', description: 'Required for directories.' },
        },
        required: ['path'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        const stat = fs.lstatSync(abs);
        if (stat.isDirectory()) {
            if (!args.recursive) throw new Error('path is a directory; set recursive=true to delete');
            fs.rmSync(abs, { recursive: true, force: false });
        } else {
            fs.unlinkSync(abs);
        }
        return { path: abs, deleted: true, type: stat.isDirectory() ? 'dir' : 'file' };
    },
    async dryRun(args) {
        try { return { wouldDelete: resolveInsideSandbox(args.path) }; }
        catch (e) { return { blocked: e.message }; }
    },
};

const fsMkdir = {
    name: 'fs_mkdir',
    category: 'sandboxed-write',
    description: 'Create a directory (and any missing parents) inside the sandbox.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute directory path to create.' },
        },
        required: ['path'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        if (fs.existsSync(abs)) throw new Error(`already exists: ${abs}`);
        fs.mkdirSync(abs, { recursive: true });
        return { path: abs, created: true };
    },
    async dryRun(args) {
        try { return { wouldCreate: resolveInsideSandbox(args.path) }; }
        catch (e) { return { blocked: e.message }; }
    },
};

const MAX_SEARCH_ENTRIES = 500;
const MAX_SEARCH_DEPTH = 12;

function _walk(dir, re, depth, out) {
    if (out.hits >= MAX_SEARCH_ENTRIES || depth > MAX_SEARCH_DEPTH) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
        if (out.hits >= MAX_SEARCH_ENTRIES) return;
        const p = path.join(dir, n);
        let isDir = false;
        try { isDir = fs.statSync(p).isDirectory(); } catch { continue; }
        if (re.test(n)) {
            out.list.push({ path: p, type: isDir ? 'dir' : 'file' });
            out.hits++;
        }
        if (isDir) _walk(p, re, depth + 1, out);
    }
}

const fsSearch = {
    name: 'fs_search',
    category: 'safe-read',
    description: 'Recursively find files/directories whose NAME matches a glob, inside an allowed root.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute directory to search from.' },
            glob: { type: 'string', description: 'Name pattern, e.g. *.pdf. Default *.' },
        },
        required: ['path'],
    },
    async run(args) {
        const abs = resolveInsideSandbox(args.path);
        if (!fs.statSync(abs).isDirectory()) throw new Error('not a directory');
        const re = _globToRegex(args.glob);
        const out = { list: [], hits: 0 };
        _walk(abs, re, 0, out);
        return { path: abs, count: out.list.length, truncated: out.hits >= MAX_SEARCH_ENTRIES, entries: out.list };
    },
};

module.exports = { fsRead, fsWrite, fsList, fsMove, fsCopy, fsDelete, fsMkdir, fsSearch };
