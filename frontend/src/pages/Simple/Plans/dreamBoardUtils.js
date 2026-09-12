/**
 * dreamBoardUtils.js — browser-only helpers for Dream board covers.
 *
 * Everything here touches the DOM (canvas, `Image`), which is why it lives apart
 * from `plansUtils.js`: that module is deliberately dependency-free so it can be
 * unit tested in plain Node, and importing this into it would drag a canvas into
 * every test run.
 */

/** Longest edge, in pixels, that an uploaded cover is stored at. */
export const COVER_MAX_EDGE = 1600;

/** JPEG quality for a re-encoded cover. */
export const COVER_JPEG_QUALITY = 0.85;

/**
 * Shrink an uploaded photo before it's stored.
 *
 * A phone photo is 3–8 MB and a dream tile renders it a few hundred pixels wide,
 * so uploading the original would spend most of a free user's 100 MB storage
 * allowance on detail nobody can see. Re-encoding to a 1600px JPEG is typically
 * a 10–30x reduction — and the tile looks identical.
 *
 * Deliberately fails *open*: any problem (no canvas, an unreadable file, an
 * exotic format) returns the original file. Refusing a user's photo because an
 * optimisation step didn't work would be a much worse outcome than a large
 * upload, and the server's own quota check is the real gate.
 *
 * @param {File|Blob} file - The file the user chose
 * @param {object} [opts]
 * @param {number} [opts.maxEdge] - Longest edge of the result
 * @param {number} [opts.quality] - JPEG quality 0–1
 * @returns {Promise<{blob: Blob, filename: string, wasResized: boolean}>}
 */
export async function downscaleImageFile(file, {
  maxEdge = COVER_MAX_EDGE,
  quality = COVER_JPEG_QUALITY,
} = {}) {
  const baseName = String(file?.name || 'dream-cover').replace(/\.[^.]+$/, '');
  const fallback = { blob: file, filename: `${baseName}.jpg`, wasResized: false };
  if (!file) return fallback;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    if (!width || !height) return fallback;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    // Already small enough — re-encoding would only lose quality.
    if (scale >= 1) {
      if (typeof bitmap.close === 'function') bitmap.close();
      return fallback;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return fallback;
    return { blob, filename: `${baseName}.jpg`, wasResized: true };
  } catch {
    return fallback;
  }
}

/**
 * Decode a file into something drawable, preferring `createImageBitmap`
 * (off-main-thread, no DOM node) and falling back to an `<img>` + object URL for
 * browsers/Safari versions without it.
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch { /* fall through to the <img> path */ }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A data URL for a generated cover as a Blob, so it can be uploaded.
 * (`uploadCoverDataUrl` in workspaceApi does this too — this version exists so
 * the picker can show a preview and upload from the same object.)
 */
export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}
