/**
 * File Processing Service
 * 
 * Handles in-memory file operations (convert, resize, compress, etc.)
 * using sharp. No files are persisted to the database.
 */

const sharp = require('sharp');
const path = require('path');

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'avif'];

/**
 * Normalize a user-provided format string to a sharp-compatible format
 */
function normalizeFormat(format) {
  const f = format.toLowerCase().replace(/^\./, '');
  const map = {
    jpg: 'jpeg', jpeg: 'jpeg',
    png: 'png', webp: 'webp',
    gif: 'gif', tiff: 'tiff', tif: 'tiff',
    avif: 'avif',
  };
  return map[f] || null;
}

function getOutputExtension(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

function getMimeType(format) {
  const map = {
    jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', tiff: 'image/tiff', avif: 'image/avif',
  };
  return map[format] || `image/${format}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Parse a natural-language instruction into a structured operation.
 */
function parseFileInstruction(instruction, originalFilename) {
  const lower = instruction.toLowerCase().trim();

  // ── Convert ──────────────────────────────────────────────────────────────
  const convertMatch = lower.match(
    /(?:convert|change|transform|make|save|export|turn)\s+(?:this\s+)?(?:file\s+)?(?:to|into|as|a)\s+\.?(\w+)/
  );
  if (convertMatch) {
    const fmt = normalizeFormat(convertMatch[1]);
    if (fmt) return { action: 'convert', targetFormat: fmt };
  }

  // Short form: "to jpg", "jpg please", ".png"
  const shortMatch = lower.match(/^(?:to\s+)?\.?(jpg|jpeg|png|webp|gif|tiff|tif|avif)\s*(?:please|pls)?$/);
  if (shortMatch) {
    const fmt = normalizeFormat(shortMatch[1]);
    if (fmt) return { action: 'convert', targetFormat: fmt };
  }

  // ── Resize ───────────────────────────────────────────────────────────────
  const resizeWH = lower.match(/(?:resize|scale|make)\s+(?:this\s+)?(?:to\s+)?(\d+)\s*[x×]\s*(\d+)/);
  if (resizeWH) return { action: 'resize', width: +resizeWH[1], height: +resizeWH[2] };

  const resizeW = lower.match(/(?:resize|scale|width|make.*wide)\s+(?:to\s+)?(\d+)\s*(?:px)?/);
  if (resizeW) return { action: 'resize', width: +resizeW[1] };

  const resizeH = lower.match(/(?:height|make.*tall)\s+(?:to\s+)?(\d+)\s*(?:px)?/);
  if (resizeH) return { action: 'resize', height: +resizeH[1] };

  // ── Compress / optimise ──────────────────────────────────────────────────
  if (/compress|optimi[sz]e|reduce\s+(?:file\s+)?size|make.*smaller/.test(lower)) {
    return { action: 'compress' };
  }

  // ── Rotate ───────────────────────────────────────────────────────────────
  const rotateMatch = lower.match(/rotate\s+(\d+)/);
  if (rotateMatch) return { action: 'rotate', angle: +rotateMatch[1] };

  // ── Flip ─────────────────────────────────────────────────────────────────
  if (/flip\s*(?:horizontal|horiz|h)/i.test(lower)) return { action: 'flip', direction: 'horizontal' };
  if (/flip/i.test(lower)) return { action: 'flip', direction: 'vertical' };

  // ── Grayscale ────────────────────────────────────────────────────────────
  if (/gra[ey]scale|black\s*(?:and|&)\s*white|b&w|b\s*w/.test(lower)) {
    return { action: 'grayscale' };
  }

  // ── Blur ─────────────────────────────────────────────────────────────────
  const blurMatch = lower.match(/blur\s*(\d+)?/);
  if (blurMatch) return { action: 'blur', sigma: +(blurMatch[1] || 5) };

  return { action: 'unknown' };
}

/**
 * Execute a file operation and return the result buffer + metadata.
 *
 * @param {Buffer}  fileBuffer       - Raw file bytes (from multer)
 * @param {string}  originalFilename - e.g. "photo.png"
 * @param {Object}  operation        - Output of parseFileInstruction()
 * @returns {Promise<{buffer: Buffer, filename: string, mimeType: string, description: string}>}
 */
async function processFile(fileBuffer, originalFilename, operation) {
  const ext = path.extname(originalFilename).slice(1).toLowerCase();
  const baseName = path.basename(originalFilename, path.extname(originalFilename));

  let pipeline = sharp(fileBuffer);

  switch (operation.action) {
    /* ── Convert ────────────────────────────────────────────────────────── */
    case 'convert': {
      const fmt = operation.targetFormat;
      if (fmt === 'jpeg')      pipeline = pipeline.jpeg({ quality: 92 });
      else if (fmt === 'webp') pipeline = pipeline.webp({ quality: 90 });
      else if (fmt === 'png')  pipeline = pipeline.png();
      else if (fmt === 'avif') pipeline = pipeline.avif({ quality: 80 });
      else if (fmt === 'tiff') pipeline = pipeline.tiff();
      else if (fmt === 'gif')  pipeline = pipeline.gif();
      else                     pipeline = pipeline.toFormat(fmt);

      const buf = await pipeline.toBuffer();
      const outExt = getOutputExtension(fmt);
      return {
        buffer: buf,
        filename: `${baseName}.${outExt}`,
        mimeType: getMimeType(fmt),
        description: `Converted **${originalFilename}** → **${outExt.toUpperCase()}** (${formatBytes(buf.length)})`,
      };
    }

    /* ── Resize ─────────────────────────────────────────────────────────── */
    case 'resize': {
      if (operation.width && operation.height) {
        pipeline = pipeline.resize(operation.width, operation.height, { fit: 'fill' });
      } else if (operation.width) {
        pipeline = pipeline.resize(operation.width, null);
      } else if (operation.height) {
        pipeline = pipeline.resize(null, operation.height);
      }
      const buf = await pipeline.toBuffer();
      const meta = await sharp(buf).metadata();
      return {
        buffer: buf,
        filename: `${baseName}_${meta.width}x${meta.height}.${ext || 'png'}`,
        mimeType: getMimeType(ext || 'png'),
        description: `Resized **${originalFilename}** → **${meta.width}×${meta.height}** (${formatBytes(buf.length)})`,
      };
    }

    /* ── Compress ────────────────────────────────────────────────────────── */
    case 'compress': {
      const meta = await sharp(fileBuffer).metadata();
      const fmt = meta.format || ext;
      if (fmt === 'jpeg' || fmt === 'jpg') pipeline = pipeline.jpeg({ quality: 70 });
      else if (fmt === 'png')              pipeline = pipeline.png({ compressionLevel: 9 });
      else if (fmt === 'webp')             pipeline = pipeline.webp({ quality: 70 });
      else                                 pipeline = pipeline.jpeg({ quality: 70 });

      const buf = await pipeline.toBuffer();
      const savings = ((1 - buf.length / fileBuffer.length) * 100).toFixed(1);
      return {
        buffer: buf,
        filename: `${baseName}_compressed.${ext || 'jpg'}`,
        mimeType: getMimeType(fmt),
        description: `Compressed **${originalFilename}** — saved **${savings}%** (${formatBytes(fileBuffer.length)} → ${formatBytes(buf.length)})`,
      };
    }

    /* ── Rotate ──────────────────────────────────────────────────────────── */
    case 'rotate': {
      const buf = await pipeline.rotate(operation.angle).toBuffer();
      return {
        buffer: buf,
        filename: `${baseName}_rotated.${ext || 'png'}`,
        mimeType: getMimeType(ext || 'png'),
        description: `Rotated **${originalFilename}** by **${operation.angle}°**`,
      };
    }

    /* ── Flip ────────────────────────────────────────────────────────────── */
    case 'flip': {
      pipeline = operation.direction === 'horizontal' ? pipeline.flop() : pipeline.flip();
      const buf = await pipeline.toBuffer();
      return {
        buffer: buf,
        filename: `${baseName}_flipped.${ext || 'png'}`,
        mimeType: getMimeType(ext || 'png'),
        description: `Flipped **${originalFilename}** ${operation.direction}`,
      };
    }

    /* ── Grayscale ───────────────────────────────────────────────────────── */
    case 'grayscale': {
      const buf = await pipeline.grayscale().toBuffer();
      return {
        buffer: buf,
        filename: `${baseName}_grayscale.${ext || 'png'}`,
        mimeType: getMimeType(ext || 'png'),
        description: `Converted **${originalFilename}** to grayscale`,
      };
    }

    /* ── Blur ────────────────────────────────────────────────────────────── */
    case 'blur': {
      const buf = await pipeline.blur(operation.sigma || 5).toBuffer();
      return {
        buffer: buf,
        filename: `${baseName}_blurred.${ext || 'png'}`,
        mimeType: getMimeType(ext || 'png'),
        description: `Applied blur (σ ${operation.sigma || 5}) to **${originalFilename}**`,
      };
    }

    /* ── Unknown ─────────────────────────────────────────────────────────── */
    default: {
      const err = new Error(
        "Couldn't understand that instruction. Try:\n" +
        '• "convert to jpg" / "png" / "webp"\n' +
        '• "resize to 800x600"\n' +
        '• "compress this"\n' +
        '• "rotate 90"\n' +
        '• "grayscale"\n' +
        '• "blur 5"'
      );
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = { parseFileInstruction, processFile, normalizeFormat, IMAGE_FORMATS };
