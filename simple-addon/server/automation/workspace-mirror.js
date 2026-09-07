/**
 * workspace-mirror.js — OpenClaw-style local-first memory mirror.
 *
 * Exports the cloud workspace (DynamoDB) to plain Markdown files under a
 * local directory so the user's memory is inspectable, grep-able, and
 * git-able — OpenClaw's "local-first, plain files" principle — without
 * changing the cloud source of truth.
 *
 * Layout:
 *   <dir>/<kind>/<slug>.md   (YAML-ish front matter + content)
 *   <dir>/README.md          (index)
 *
 * Pure over injected `wsClient` + the local filesystem — fully offline-testable.
 */

const path = require('path');
const fs = require('fs');

const MIRROR_KINDS = ['core', 'agent', 'knowledge', 'notebook', 'skill', 'log', 'decision', 'project', 'goal', 'lesson'];
const MAX_ITEMS_PER_KIND = 50;

function _header(item, kind) {
    const lines = ['---'];
    lines.push(`kind: ${item.kind || kind || ''}`);
    lines.push(`slug: ${item.slug || ''}`);
    if (item.name) lines.push(`name: ${item.name}`);
    if (item.status) lines.push(`status: ${item.status}`);
    if (item.updatedAt) lines.push(`updatedAt: ${item.updatedAt}`);
    lines.push('---');
    return lines.join('\n') + '\n\n';
}

function _body(item) {
    if (typeof item.content === 'string') return item.content;
    if (item.text != null) return String(item.text);
    return JSON.stringify(item.content || {}, null, 2);
}

/**
 * Export workspace items to local Markdown files.
 * @param {object} opts - { wsClient, dir, log?, kinds? }
 * @param {object} opts.wsClient - needs listWorkspaceItems(kind) + getWorkspaceItem(kind, slug)
 * @returns {Promise<{dir:string, files:string[], bytes:number, errors:number}>}
 */
async function mirrorWorkspace({ wsClient, dir, log = () => {}, kinds = MIRROR_KINDS }) {
    const files = [];
    let bytes = 0;
    let errors = 0;

    fs.mkdirSync(dir, { recursive: true });

    for (const kind of kinds) {
        let entries = [];
        try {
            const out = await wsClient.listWorkspaceItems(kind);
            entries = (out?.entries) || (Array.isArray(out) ? out : []);
        } catch (e) {
            errors++;
            log(`[mirror] list ${kind} failed: ${e.message}`);
            continue;
        }
        const kindDir = path.join(dir, kind);
        try { fs.mkdirSync(kindDir, { recursive: true }); } catch (e) { errors++; continue; }

        for (const entry of entries.slice(0, MAX_ITEMS_PER_KIND)) {
            let item = entry;
            // List entries are lightweight (no content) — fetch the full item.
            try { item = (await wsClient.getWorkspaceItem(kind, entry.slug)) || entry; }
            catch { /* keep the lightweight entry */ }
            const safeSlug = String(item.slug || entry.slug || 'item').replace(/[^a-z0-9_-]+/g, '-');
            const content = _header(item, kind) + _body(item);
            const filePath = path.join(kindDir, `${safeSlug}.md`);
            try {
                fs.writeFileSync(filePath, content, 'utf-8');
                files.push(filePath);
                bytes += Buffer.byteLength(content, 'utf-8');
            } catch { errors++; }
        }
    }

    try {
        const index = '# Simple Workspace Mirror\n\n' +
            'Exported from the cloud workspace. Each folder is a workspace kind; each file is one item.\n\n' +
            kinds.map((k) => `- \`${k}/\``).join('\n') + '\n';
        fs.writeFileSync(path.join(dir, 'README.md'), index, 'utf-8');
    } catch { errors++; }

    return { dir, files, bytes, errors };
}

module.exports = { mirrorWorkspace, MIRROR_KINDS, MAX_ITEMS_PER_KIND };
