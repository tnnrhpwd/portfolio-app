'use strict';
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, 'server', 'index.js');
let s = fs.readFileSync(f, 'utf-8');

// ── Fix 1: Replace loadMemoryContext body with relevance-based loading ──
const LOAD_MARKER = 'function loadMemoryContext(message = \'\')';
const loadStart = s.indexOf(LOAD_MARKER);
if (loadStart === -1) {
    // Try alternate signatures
    const alt = 'function loadMemoryContext(message)';
    const alt2 = 'function loadMemoryContext()';
    const pos = s.indexOf(alt) !== -1 ? s.indexOf(alt) : s.indexOf(alt2);
    if (pos === -1) { console.log('ERROR: loadMemoryContext not found'); process.exit(1); }
}
const fnStart = s.indexOf(LOAD_MARKER) !== -1 ? s.indexOf(LOAD_MARKER) : s.indexOf('function loadMemoryContext');
const braceStart = s.indexOf('{', fnStart);
let depth = 0, end = braceStart;
for (let i = braceStart; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}

const newLoadBody = `function loadMemoryContext(message) {
  if (!fs.existsSync(MEMORY_PATH)) return '';
  try {
    const allFiles = fs.readdirSync(MEMORY_PATH)
      .filter(f => !fs.statSync(path.join(MEMORY_PATH, f)).isDirectory());
    if (allFiles.length === 0) return '';
    const fileInfos = allFiles.map(f => {
      const fp = path.join(MEMORY_PATH, f);
      const size = fs.statSync(fp).size;
      const isCore = MEMORY_CORE_PATTERNS.some(p => p.test(f));
      return { name: f, path: fp, size, isCore };
    });
    // Core files (name/profile/identity) always loaded; topic files relevance-filtered
    const coreFiles = fileInfos.filter(f => f.isCore && f.size <= MAX_SINGLE_FILE_BYTES);
    const topicFiles = fileInfos.filter(f => !f.isCore);
    const scoredTopics = topicFiles.map(f => {
      if (f.size > MAX_SINGLE_FILE_BYTES) return { ...f, score: -1 };
      let snippet = '';
      try { snippet = fs.readFileSync(f.path, 'utf-8').trim().slice(0, 500); } catch {}
      return { ...f, score: _scoreMemoryRelevance(snippet, message || '') };
    }).filter(f => f.score > 0 || !message).sort((a, b) => b.score - a.score);
    const toLoad = [...coreFiles, ...scoredTopics];
    const memories = [];
    let totalSize = 0;
    const oversized = fileInfos.filter(f => f.size > MAX_SINGLE_FILE_BYTES);
    for (const info of toLoad) {
      if (info.size > MAX_SINGLE_FILE_BYTES) continue;
      try {
        const content = fs.readFileSync(info.path, 'utf-8').trim();
        if (!content) continue;
        const entrySize = Buffer.byteLength(content, 'utf-8');
        if (totalSize + entrySize > MAX_MEMORY_CONTEXT_BYTES) {
          memories.push('[' + (toLoad.length - memories.length) + ' more memory files omitted — not relevant]');
          break;
        }
        const displayName = info.name.replace(/\\.[^.]+$/, '').replace(/_/g, ' ');
        memories.push('## ' + displayName + '\\n' + content);
        totalSize += entrySize;
      } catch (err) { console.log('[Memory] Failed to read ' + info.name + ': ' + err.message); }
    }
    if (memories.length === 0) return '';
    if (oversized.length > 0) console.log('[Memory] ' + oversized.length + ' oversized file(s) skipped (auto-consolidating on next save)');
    const loaded = memories.filter(m => !m.startsWith('[')).length;
    console.log('[Memory] Loaded ' + loaded + '/' + fileInfos.length + ' files (' + (totalSize/1024).toFixed(1) + 'KB)');
    return '\\n\\n--- MEMORY (persistent knowledge) ---\\n' + memories.join('\\n\\n') + '\\n--- END MEMORY ---\\n';
  } catch (err) {
    console.log('[Memory] Failed to load memory context: ' + err.message);
    return '';
  }
}`;

s = s.slice(0, fnStart) + newLoadBody + s.slice(end + 1);
console.log('✓ loadMemoryContext replaced');

// ── Fix 2+3: Cap writes + auto-consolidate in processMemorySaves ──
// Find the write block inside processMemorySaves
const WRITE_MARKER = '      const isUpdate = fs.existsSync(filePath);\n      fs.writeFileSync(filePath, content,';
const writePos = s.indexOf(WRITE_MARKER);
if (writePos === -1) {
    console.log('ERROR: write marker not found in processMemorySaves');
} else {
    // Find end of the try block's write section (up to closing log line)
    const logEnd = s.indexOf('\n    }', writePos);
    const oldWrite = s.slice(writePos, logEnd);
    const newWrite = `      // IMPROVEMENT 2: Cap write at ${2048} bytes — prevents 500KB memory dumps
      const capped = Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_WRITE_BYTES
        ? content.slice(0, MAX_MEMORY_WRITE_BYTES) + '\\n[...truncated to 2KB limit]'
        : content;
      const isUpdate = fs.existsSync(filePath);
      fs.writeFileSync(filePath, capped, 'utf-8');
      savedMemories.push({ filename: rawFilename, action: isUpdate ? 'updated' : 'created', bytes: Buffer.byteLength(capped, 'utf-8') });
      console.log('[Memory Auto-Save] ' + (isUpdate ? 'Updated' : 'Created') + ': ' + rawFilename + ' (' + (Buffer.byteLength(capped,'utf-8')/1024).toFixed(1) + 'KB)');
      // IMPROVEMENT 3: Auto-consolidate if the file is still too large
      try { if (fs.statSync(filePath).size > MAX_SINGLE_FILE_BYTES) consolidateMemoryFile(filePath); } catch {}`;
    s = s.slice(0, writePos) + newWrite + s.slice(writePos + oldWrite.length);
    console.log('✓ processMemorySaves write replaced');
}

// Remove old size validation block (now redundant — we cap ourselves)
const SIZE_VAL = '    // Validate content size\n    const sizeErr = validateFileContent(content);\n    if (sizeErr) {\n      console.log(`[Memory Auto-Save] Content too large for "${rawFilename}": ${sizeErr}`);\n      continue;\n    }\n\n    ';
if (s.includes(SIZE_VAL)) {
    s = s.replace(SIZE_VAL, '    ');
    console.log('✓ Old size validation removed');
}

fs.writeFileSync(f, s, 'utf-8');
console.log('Done.');
