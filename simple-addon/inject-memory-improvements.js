// This is a helper script to inject the new memory functions
// Run: node inject-memory-improvements.js
const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'server', 'index.js');
let src = fs.readFileSync(targetFile, 'utf-8');

// ── IMPROVEMENT 1: Relevance-scoring + Improvement 3: Auto-consolidation helpers ──
const RELEVANCE_HELPER = `
/**
 * Score a memory file's content against the current message (0–1).
 * Uses word-overlap with stopword filtering — zero LLM cost.
 */
function _scoreMemoryRelevance(content, message) {
  if (!content || !message) return 0;
  const stop = new Set(['the','a','an','of','to','for','and','or','in','on','at','with','from',
                        'by','is','are','it','this','that','was','be','as','i','you','my','me']);
  const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !stop.has(t));
  const msgTokens = new Set(tokenize(message));
  const memTokens = tokenize(content);
  if (msgTokens.size === 0 || memTokens.length === 0) return 0;
  let hits = 0;
  for (const t of memTokens) if (msgTokens.has(t)) hits++;
  return Math.min(1, hits / Math.max(msgTokens.size, 1));
}

/**
 * Auto-consolidate an oversized memory file: keep the most recent facts that
 * fit within MAX_SINGLE_FILE_BYTES / 2, discard older lines.
 * Called automatically after every [MEMORY_SAVE] write that exceeds the limit.
 */
function consolidateMemoryFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const TARGET = Math.floor(MAX_SINGLE_FILE_BYTES / 2);
    if (Buffer.byteLength(raw, 'utf-8') <= TARGET) return;
    const lines = raw.split('\\n').filter(l => l.trim());
    const kept = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineSize = Buffer.byteLength(lines[i] + '\\n', 'utf-8');
      if (size + lineSize > TARGET) break;
      kept.unshift(lines[i]);
      size += lineSize;
    }
    const header = \`# [Auto-consolidated \${new Date().toISOString().slice(0,10)} — older entries removed]\\n\\n\`;
    fs.writeFileSync(filePath, header + kept.join('\\n') + '\\n', 'utf-8');
    console.log(\`[Memory] Consolidated \${path.basename(filePath)}: \${(Buffer.byteLength(raw,'utf-8')/1024).toFixed(1)}KB → \${(size/1024).toFixed(1)}KB\`);
  } catch (err) {
    console.warn(\`[Memory] Consolidation failed for \${path.basename(filePath)}:\`, err.message);
  }
}

`;

// Insert helpers before loadMemoryContext
src = src.replace('function loadMemoryContext()', RELEVANCE_HELPER + 'function loadMemoryContext(message = \'\')');

// ── IMPROVEMENT 1: Replace body of loadMemoryContext ──
const OLD_LOAD_BODY = `  try {
    const allFiles = fs.readdirSync(MEMORY_PATH)
      .filter(f => !fs.statSync(path.join(MEMORY_PATH, f)).isDirectory());

    if (allFiles.length === 0) return '';

    // Build file info with sizes so we can sort smartly
    const fileInfos = allFiles.map(f => {
      const fp = path.join(MEMORY_PATH, f);
      const size = fs.statSync(fp).size;
      return { name: f, path: fp, size };
    });

    // Priority order: user-related files first, then by size (small → large)
    const PRIORITY_PATTERNS = [/^user/i, /profile/i, /preference/i, /identity/i, /name/i];
    fileInfos.sort((a, b) => {
      const aPri = PRIORITY_PATTERNS.findIndex(p => p.test(a.name));
      const bPri = PRIORITY_PATTERNS.findIndex(p => p.test(b.name));
      const aHasPri = aPri !== -1;
      const bHasPri = bPri !== -1;
      if (aHasPri && !bHasPri) return -1;
      if (!aHasPri && bHasPri) return 1;
      if (aHasPri && bHasPri) return aPri - bPri; // earlier pattern wins
      return a.size - b.size; // smaller files first
    });

    const memories = [];
    let totalSize = 0;
    let skipped = 0;

    for (const info of fileInfos) {
      // Skip individual files that are too large (legacy dumps, logs, etc.)
      if (info.size > MAX_SINGLE_FILE_BYTES) {
        console.log(\`[Memory] Skipping oversized file: \${info.name} (\${(info.size / 1024).toFixed(1)}KB)\`);
        skipped++;
        continue;
      }

      try {
        const content = fs.readFileSync(info.path, 'utf-8').trim();
        if (!content) continue;

        const entrySize = Buffer.byteLength(content, 'utf-8');
        if (totalSize + entrySize > MAX_MEMORY_CONTEXT_BYTES) {
          memories.push(\`[Memory truncated — \${fileInfos.length - memories.length - skipped} more files not loaded due to size limit]\`);
          break;
        }

        const displayName = info.name.replace(/\\.[^.]+$/, '').replace(/_/g, ' ');
        memories.push(\`## \${displayName}\\n\${content}\`);
        totalSize += entrySize;
      } catch (err) {
        console.log(\`[Memory] Failed to read \${info.name}: \${err.message}\`);
      }
    }

    if (memories.length === 0) return '';
    return '\\n\\n--- MEMORY (persistent knowledge) ---\\n' +
           memories.join('\\n\\n') +
           '\\n--- END MEMORY ---\\n';
  } catch (err) {
    console.log(\`[Memory] Failed to load memory context: \${err.message}\`);
    return '';
  }`;

const NEW_LOAD_BODY = `  try {
    const allFiles = fs.readdirSync(MEMORY_PATH)
      .filter(f => !fs.statSync(path.join(MEMORY_PATH, f)).isDirectory());
    if (allFiles.length === 0) return '';

    const fileInfos = allFiles.map(f => {
      const fp = path.join(MEMORY_PATH, f);
      const size = fs.statSync(fp).size;
      const isCore = MEMORY_CORE_PATTERNS.some(p => p.test(f));
      return { name: f, path: fp, size, isCore };
    });

    // Core files: always loaded; topic files: only load when relevant to message
    const coreFiles = fileInfos.filter(f => f.isCore && f.size <= MAX_SINGLE_FILE_BYTES);
    const topicFiles = fileInfos.filter(f => !f.isCore);

    // Score topic files against the message; keep top matches
    const scoredTopics = topicFiles.map(f => {
      if (f.size > MAX_SINGLE_FILE_BYTES) return { ...f, score: -1 };
      let snippet = '';
      try { snippet = fs.readFileSync(f.path, 'utf-8').trim().slice(0, 500); } catch {}
      return { ...f, score: _scoreMemoryRelevance(snippet, message) };
    }).filter(f => f.score > 0 || !message).sort((a, b) => b.score - a.score);

    const toLoad = [...coreFiles, ...scoredTopics];
    const memories = [];
    let totalSize = 0;
    let skipped = fileInfos.filter(f => f.size > MAX_SINGLE_FILE_BYTES).length;

    for (const info of toLoad) {
      if (info.size > MAX_SINGLE_FILE_BYTES) { skipped++; continue; }
      try {
        const content = fs.readFileSync(info.path, 'utf-8').trim();
        if (!content) continue;
        const entrySize = Buffer.byteLength(content, 'utf-8');
        if (totalSize + entrySize > MAX_MEMORY_CONTEXT_BYTES) {
          memories.push(\`[\${toLoad.length - memories.length} more memory files omitted — not relevant to this message]\`);
          break;
        }
        const displayName = info.name.replace(/\\.[^.]+$/, '').replace(/_/g, ' ');
        memories.push(\`## \${displayName}\\n\${content}\`);
        totalSize += entrySize;
      } catch (err) { console.log(\`[Memory] Failed to read \${info.name}: \${err.message}\`); }
    }

    if (memories.length === 0) return '';
    const loaded = memories.filter(m => !m.startsWith('[')).length;
    if (skipped > 0) console.log(\`[Memory] \${skipped} oversized file(s) skipped — will be auto-consolidated on next save\`);
    console.log(\`[Memory] Loaded \${loaded}/\${fileInfos.length} files (\${(totalSize/1024).toFixed(1)}KB)\`);
    return '\\n\\n--- MEMORY (persistent knowledge) ---\\n' +
           memories.join('\\n\\n') +
           '\\n--- END MEMORY ---\\n';
  } catch (err) {
    console.log(\`[Memory] Failed to load memory context: \${err.message}\`);
    return '';
  }`;

if (src.includes(OLD_LOAD_BODY.slice(0, 80))) {
    src = src.replace(OLD_LOAD_BODY, NEW_LOAD_BODY);
    console.log('✓ Replaced loadMemoryContext body');
} else {
    console.log('✗ loadMemoryContext body not found (may already be updated)');
}

// ── IMPROVEMENT 2: Cap writes at MAX_MEMORY_WRITE_BYTES ──
// ── IMPROVEMENT 3: Auto-consolidate after write ──
const OLD_WRITE = `    // Validate content size
    const sizeErr = validateFileContent(content);
    if (sizeErr) {
      console.log(\`[Memory Auto-Save] Content too large for "\${rawFilename}": \${sizeErr}\`);
      continue;
    }

    try {
      if (!fs.existsSync(MEMORY_PATH)) {
        fs.mkdirSync(MEMORY_PATH, { recursive: true });
      }

      const isUpdate = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, 'utf-8');
      savedMemories.push({
        filename: rawFilename,
        action: isUpdate ? 'updated' : 'created',
      });
      console.log(\`[Memory Auto-Save] \${isUpdate ? 'Updated' : 'Created'}: \${rawFilename}\`);
    } catch (err) {
      console.error(\`[Memory Auto-Save] Failed to save "\${rawFilename}": \${err.message}\`);
    }`;

const NEW_WRITE = `    // IMPROVEMENT 2: Cap write size to prevent memory bloat (2KB max per file write)
    const MAX_WRITE = MAX_MEMORY_WRITE_BYTES;
    const truncatedContent = Buffer.byteLength(content, 'utf-8') > MAX_WRITE
      ? content.slice(0, MAX_WRITE) + '\\n[...truncated to 2KB limit]'
      : content;

    try {
      if (!fs.existsSync(MEMORY_PATH)) {
        fs.mkdirSync(MEMORY_PATH, { recursive: true });
      }

      const isUpdate = fs.existsSync(filePath);
      fs.writeFileSync(filePath, truncatedContent, 'utf-8');
      savedMemories.push({
        filename: rawFilename,
        action: isUpdate ? 'updated' : 'created',
        bytes: Buffer.byteLength(truncatedContent, 'utf-8'),
      });
      console.log(\`[Memory Auto-Save] \${isUpdate ? 'Updated' : 'Created'}: \${rawFilename} (\${(Buffer.byteLength(truncatedContent,'utf-8')/1024).toFixed(1)}KB)\`);

      // IMPROVEMENT 3: Auto-consolidate if the file is now too large
      if (fs.statSync(filePath).size > MAX_SINGLE_FILE_BYTES) {
        consolidateMemoryFile(filePath);
      }
    } catch (err) {
      console.error(\`[Memory Auto-Save] Failed to save "\${rawFilename}": \${err.message}\`);
    }`;

if (src.includes(OLD_WRITE.slice(0, 60))) {
    src = src.replace(OLD_WRITE, NEW_WRITE);
    console.log('✓ Replaced processMemorySaves write logic');
} else {
    console.log('✗ processMemorySaves write not found');
}

// Fix loadMemoryContext call sites to pass the message
src = src.replace(
    /const memoryContext = loadMemoryContext\(\);/g,
    'const memoryContext = loadMemoryContext(message);'
);
console.log('✓ Updated loadMemoryContext() call sites to pass message');

fs.writeFileSync(targetFile, src, 'utf-8');
console.log('Done writing', targetFile);
