import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import './ProfilePictureEditor.css';

/** Longest edge of the square image we bake and store. */
const OUTPUT_SIZE = 512;
/** Largest source file we will even attempt to decode. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024; // 8 MB
/** Zoom range (1 = image exactly covers the frame). */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const JPEG_QUALITY = 0.85;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * ProfilePictureEditor — modal that lets a user pick an image, then pan and
 * zoom it inside a circular (and square) crop frame before saving.
 *
 * The visible frame is square, so whatever the user sees inside it is exactly
 * what we bake into a 512×512 JPEG on a canvas. That keeps rendering trivial
 * everywhere else: the saved value is a ready-to-display `data:` URL, so the
 * avatar never has to redo any crop math.
 *
 * @param {Object}   props
 * @param {boolean}  props.open        Whether the modal is visible.
 * @param {Function} props.onClose     Called to dismiss the modal.
 * @param {Function} props.onSave      Async (dataUrl|null) => void. Runs on "Save photo"/"Remove photo".
 * @param {string}   [props.currentPicture] Existing picture, used to enable "Remove photo".
 * @param {boolean}  [props.saving]    Disables actions while the request is in flight.
 */
function ProfilePictureEditor({ open, onClose, onSave, currentPicture = null, saving = false }) {
  const [sourceUrl, setSourceUrl] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState(260);

  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const fileInputRef = useRef(null);

  // Reset whenever the modal opens so a previous session's pan/zoom never leaks in.
  useEffect(() => {
    if (open) {
      setSourceUrl(null);
      setNaturalSize({ width: 0, height: 0 });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open]);

  // Keep the crop frame sized to the viewport (square, clamped for phones).
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const available = Math.min(window.innerWidth - 48, window.innerHeight - 260);
      setFrameSize(Math.max(180, Math.min(300, available)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Escape closes the modal (unless a save is running).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  // Compute the displayed image box for the current frame/zoom/offset.
  const displayed = (() => {
    if (!naturalSize.width || !frameSize) return null;
    const baseScale = Math.max(frameSize / naturalSize.width, frameSize / naturalSize.height);
    const scale = baseScale * zoom;
    const width = naturalSize.width * scale;
    const height = naturalSize.height * scale;
    return { width, height };
  })();

  // Clamp an offset so the image always fully covers the frame.
  const clampOffset = useCallback((next, size) => {
    if (!size || !frameSize) return { x: 0, y: 0 };
    const minX = frameSize - size.width;
    const minY = frameSize - size.height;
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  }, [frameSize]);

  const centerOffset = useCallback((size) => (
    size ? { x: (frameSize - size.width) / 2, y: (frameSize - size.height) / 2 } : { x: 0, y: 0 }
  ), [frameSize]);

  // Centre the image whenever a new source is loaded or the frame resizes.
  useEffect(() => {
    if (displayed) setOffset(centerOffset(displayed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, frameSize, naturalSize.width, naturalSize.height]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Please choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error(`Image is too large (max ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB).`);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(1);
      setSourceUrl(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error('That image could not be read. Try a different file.');
    };
    img.src = url;
  }, []);

  // Revoke the object URL when it changes/unmounts to avoid leaking memory.
  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  // ── Dragging ────────────────────────────────────────────────────────────
  const onPointerDown = (event) => {
    if (!displayed) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || !displayed) return;
    const next = {
      x: drag.origin.x + (event.clientX - drag.startX),
      y: drag.origin.y + (event.clientY - drag.startY),
    };
    setOffset(clampOffset(next, displayed));
  };

  const onPointerUp = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleZoom = (value) => {
    const nextZoom = Number(value);
    if (!displayed || !naturalSize.width) {
      setZoom(nextZoom);
      return;
    }
    // Keep whatever is at the centre of the frame centred while zooming.
    const scale = Math.max(frameSize / naturalSize.width, frameSize / naturalSize.height) * nextZoom;
    const nextSize = { width: naturalSize.width * scale, height: naturalSize.height * scale };
    const cx = (frameSize / 2 - offset.x) / displayed.width; // 0..1 position under the centre
    const cy = (frameSize / 2 - offset.y) / displayed.height;
    const next = {
      x: frameSize / 2 - cx * nextSize.width,
      y: frameSize / 2 - cy * nextSize.height,
    };
    setZoom(nextZoom);
    setOffset(clampOffset(next, nextSize));
  };

  const handleSave = async () => {
    if (!sourceUrl || !displayed || !naturalSize.width) {
      toast.error('Choose a photo first.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      // Fill first so transparent PNGs are flattened onto white, not black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = sourceUrl;
      });

      const k = OUTPUT_SIZE / frameSize;
      ctx.drawImage(img, offset.x * k, offset.y * k, displayed.width * k, displayed.height * k);

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      await onSave(dataUrl);
    } catch (error) {
      console.error('Failed to bake profile picture:', error);
      toast.error('Could not process that image. Please try another.');
    }
  };

  const handleRemove = async () => {
    try {
      await onSave(null);
    } catch (error) {
      console.error('Failed to remove profile picture:', error);
    }
  };

  if (!open) return null;

  return (
    <div className="ppe-overlay" role="presentation" onMouseDown={() => !saving && onClose()}>
      <div
        className="ppe-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ppe-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ppe-header">
          <div>
            <p className="ppe-eyebrow">Profile photo</p>
            <h2 className="ppe-title" id="ppe-title">Adjust your picture</h2>
          </div>
          <button
            type="button"
            className="ppe-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close photo editor"
          >
            ✕
          </button>
        </header>

        <input
          ref={fileInputRef}
          id="ppe-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="ppe-file-input"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            // Clear so picking the same file twice still fires onChange.
            event.target.value = '';
          }}
        />

        {!sourceUrl ? (
          <div className="ppe-drop">
            <div className="ppe-drop-icon" aria-hidden="true">🖼️</div>
            <p className="ppe-drop-title">Upload a photo</p>
            <p className="ppe-drop-text">
              PNG, JPEG, or WebP up to 8&nbsp;MB. You&apos;ll be able to zoom and reposition it next.
            </p>
            <button
              type="button"
              className="ppe-btn ppe-btn-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </button>
          </div>
        ) : (
          <>
            <div
              className="ppe-frame"
              ref={frameRef}
              style={{ width: `${frameSize}px`, height: `${frameSize}px` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="presentation"
              title="Drag to reposition"
            >
              <img
                className="ppe-frame-image"
                src={sourceUrl}
                alt=""
                draggable={false}
                style={{
                  width: `${displayed?.width || 0}px`,
                  height: `${displayed?.height || 0}px`,
                  left: `${offset.x}px`,
                  top: `${offset.y}px`,
                }}
              />
              <div className="ppe-frame-ring" aria-hidden="true" />
            </div>
            <p className="ppe-frame-hint">Drag to reposition · use the slider to zoom</p>

            <label className="ppe-zoom" htmlFor="ppe-zoom-range">
              <span className="ppe-zoom-label">Zoom</span>
              <input
                id="ppe-zoom-range"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                onChange={(event) => handleZoom(event.target.value)}
                className="ppe-zoom-range"
              />
              <span className="ppe-zoom-value">{Math.round(zoom * 100)}%</span>
            </label>
          </>
        )}

        <footer className="ppe-actions">
          {sourceUrl && (
            <button
              type="button"
              className="ppe-btn ppe-btn-ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
            >
              Replace
            </button>
          )}
          {currentPicture && (
            <button
              type="button"
              className="ppe-btn ppe-btn-danger"
              onClick={handleRemove}
              disabled={saving}
            >
              Remove photo
            </button>
          )}
          <span className="ppe-actions-spacer" />
          <button
            type="button"
            className="ppe-btn ppe-btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ppe-btn ppe-btn-primary"
            onClick={handleSave}
            disabled={saving || !sourceUrl}
          >
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ProfilePictureEditor;
