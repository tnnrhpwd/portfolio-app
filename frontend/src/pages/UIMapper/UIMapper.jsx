import React, { useState, useRef, useEffect, useCallback } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO';
import useScrollReveal from '../../hooks/useScrollReveal';
import './UIMapper.css';

// Rotating palette so each new box gets a distinct color.
const PALETTE = [
  '#e8b84b',
  '#4caf50',
  '#42a5f5',
  '#ef5350',
  '#ab47bc',
  '#ff9800',
  '#26c6da',
  '#8d6e63',
];

let idSeq = 0;
const nextId = () => {
  idSeq += 1;
  return `r${idSeq}`;
};

/**
 * Internal layout tool: upload a reference screenshot, drag to draw boxes
 * around UI components, name each one in the table, then export/copy a JSON
 * spec with pixel + normalized (0..1) coordinates.
 */
export default function UIMapper() {
  const [image, setImage] = useState(null); // { src, name, naturalWidth, naturalHeight }
  const [zoom, setZoom] = useState(1);
  const [regions, setRegions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drawing, setDrawing] = useState(null); // { x0, y0, x1, y1 } in image px
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);
  const drawingRef = useRef(null);

  // Scroll-triggered reveals (see FRONTEND_UI_STANDARD.md §5).
  const [heroRef, heroVisible] = useScrollReveal();
  const [mainRef, mainVisible] = useScrollReveal();

  // ── Image loading ──
  const loadFile = useCallback((file) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG/JPG).');
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setImage({
        src: url,
        name: file.name,
        naturalWidth: probe.naturalWidth,
        naturalHeight: probe.naturalHeight,
      });
      setRegions([]);
      setSelectedId(null);
      setZoom(1);
      requestAnimationFrame(() => {
        if (scrollRef.current && probe.naturalWidth > 0) {
          const fit = (scrollRef.current.clientWidth - 32) / probe.naturalWidth;
          setZoom(Math.min(1, Math.max(0.05, fit)));
        }
      });
    };
    probe.onerror = () => {
      setError('Could not load that image.');
      URL.revokeObjectURL(url);
    };
    probe.src = url;
  }, []);

  // Revoke the previous object URL whenever the image changes/unmounts.
  useEffect(() => {
    if (!image) return undefined;
    return () => URL.revokeObjectURL(image.src);
  }, [image]);

  // ── Coordinate mapping (screen px → image px) ──
  const toImageCoords = useCallback(
    (clientX, clientY) => {
      const img = imgRef.current;
      if (!img || !image) return { x: 0, y: 0 };
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0, y: 0 };
      return {
        x: ((clientX - rect.left) / rect.width) * image.naturalWidth,
        y: ((clientY - rect.top) / rect.height) * image.naturalHeight,
      };
    },
    [image],
  );

  const onDrawMouseDown = (e) => {
    if (!image || e.button !== 0) return;
    e.preventDefault();
    const p = toImageCoords(e.clientX, e.clientY);
    const d = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drawingRef.current = d;
    setDrawing(d);
  };

  // While a box is being drawn, track pointer on the window so dragging off
  // the image still commits cleanly.
  const isDrawing = drawing !== null;
  useEffect(() => {
    if (!isDrawing) return undefined;
    const move = (e) => {
      const d = drawingRef.current;
      if (!d) return;
      const p = toImageCoords(e.clientX, e.clientY);
      const next = { x0: d.x0, y0: d.y0, x1: p.x, y1: p.y };
      drawingRef.current = next;
      setDrawing(next);
    };
    const up = () => {
      const d = drawingRef.current;
      drawingRef.current = null;
      setDrawing(null);
      if (!d) return;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w > 2 && h > 2) {
        const id = nextId();
        setRegions((rs) => [
          ...rs,
          {
            id,
            name: `Region ${rs.length + 1}`,
            x,
            y,
            w,
            h,
            color: PALETTE[rs.length % PALETTE.length],
          },
        ]);
        setSelectedId(id);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [isDrawing, toImageCoords]);

  // Delete key removes the selected region.
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target.tagName === 'INPUT')) {
        setRegions((rs) => rs.filter((r) => r.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // ── Region edits ──
  const renameRegion = (id, name) =>
    setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)));

  const deleteRegion = (id) => {
    setRegions((rs) => rs.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const clearAll = () => {
    setRegions([]);
    setSelectedId(null);
  };

  // ── Zoom ──
  const zoomBy = (f) => setZoom((z) => Math.min(4, Math.max(0.1, z * f)));

  const fitZoom = () => {
    if (!image || !scrollRef.current) return;
    const fit = (scrollRef.current.clientWidth - 32) / image.naturalWidth;
    setZoom(Math.min(4, Math.max(0.05, fit)));
  };

  // ── Export ──
  const buildSpec = () => {
    if (!image) return null;
    return {
      source: image.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
      regions: regions.map((r) => ({
        name: r.name,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.w),
        h: Math.round(r.h),
        nx: +(r.x / image.naturalWidth).toFixed(4),
        ny: +(r.y / image.naturalHeight).toFixed(4),
        nw: +(r.w / image.naturalWidth).toFixed(4),
        nh: +(r.h / image.naturalHeight).toFixed(4),
      })),
    };
  };

  const downloadJson = () => {
    const spec = buildSpec();
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ui-map.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    const spec = buildSpec();
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard is blocked — use Download instead.');
    }
  };

  const previewStyle = drawing
    ? (() => {
        const x = Math.min(drawing.x0, drawing.x1) * zoom;
        const y = Math.min(drawing.y0, drawing.y1) * zoom;
        const w = Math.abs(drawing.x1 - drawing.x0) * zoom;
        const h = Math.abs(drawing.y1 - drawing.y0) * zoom;
        return { left: x, top: y, width: w, height: h };
      })()
    : null;

  return (
    <div className="uim-page">
      <SEO
        title="UI Mapper"
        description="Upload a reference screenshot and draw named boxes around components to build a layout spec."
        path="/uimapper"
      />
      <Header />

      {/* Decorative, non-interactive background circles */}
      <div className="uim-floating" aria-hidden="true">
        <div className="uim-circle uim-circle-1" />
        <div className="uim-circle uim-circle-2" />
        <div className="uim-circle uim-circle-3" />
      </div>

      {/* Hero: eyebrow → title → subtitle */}
      <section
        ref={heroRef}
        className={`uim-section uim-hero uim-reveal ${heroVisible ? 'is-visible' : ''}`}
      >
        <div className="uim-title-wrap">
          <p className="uim-eyebrow">Internal tool</p>
          <h1 className="uim-title">UI Mapper</h1>
          <p className="uim-subtitle">
            Upload a reference screenshot, drag to draw boxes around components, name them in the
            table, then export or copy the JSON spec (pixel + normalized coordinates).
          </p>
        </div>
      </section>

      <main
        id="main"
        ref={mainRef}
        className={`uim-section uim-main uim-reveal ${mainVisible ? 'is-visible' : ''}`}
      >
        <div className="uim-card">
          {error && (
            <p className="uim-error" role="alert">
              {error}
            </p>
          )}

          {!image ? (
            <div
              className="uim-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                loadFile(e.dataTransfer.files?.[0]);
              }}
            >
              <p>Drop an image here, or click to browse</p>
            </div>
          ) : (
            <>
              <div className="uim-toolbar">
                <button
                  type="button"
                  className="uim-btn uim-btn-outline"
                  onClick={() => fileRef.current?.click()}
                >
                  Change image
                </button>
                <button
                  type="button"
                  className="uim-btn uim-btn-outline uim-btn--icon"
                  onClick={() => zoomBy(1.25)}
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  +
                </button>
                <button
                  type="button"
                  className="uim-btn uim-btn-outline uim-btn--icon"
                  onClick={() => zoomBy(0.8)}
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button type="button" className="uim-btn uim-btn-outline" onClick={fitZoom}>
                  Fit
                </button>
                <button type="button" className="uim-btn uim-btn-outline" onClick={() => setZoom(1)}>
                  100%
                </button>
                <span className="uim-zoom">{Math.round(zoom * 100)}%</span>
                <span className="uim-spacer" />
                <button
                  type="button"
                  className="uim-btn uim-btn-outline"
                  onClick={clearAll}
                  disabled={regions.length === 0}
                >
                  Clear all
                </button>
                <button
                  type="button"
                  className="uim-btn"
                  onClick={copyJson}
                  disabled={regions.length === 0}
                >
                  {copied ? 'Copied!' : 'Copy JSON'}
                </button>
                <button
                  type="button"
                  className="uim-btn"
                  onClick={downloadJson}
                  disabled={regions.length === 0}
                >
                  Download JSON
                </button>
              </div>

              <div className="uim-stage" ref={scrollRef}>
                <div
                  className="uim-image-wrap"
                  style={{ width: image.naturalWidth * zoom, height: image.naturalHeight * zoom }}
                >
                  <img
                    ref={imgRef}
                    src={image.src}
                    alt={image.name}
                    className="uim-img"
                    draggable={false}
                  />
                  <div className="uim-draw" onMouseDown={onDrawMouseDown}>
                    {regions.map((r) => (
                      <div
                        key={r.id}
                        className={selectedId === r.id ? 'uim-box uim-box--sel' : 'uim-box'}
                        style={{
                          left: r.x * zoom,
                          top: r.y * zoom,
                          width: r.w * zoom,
                          height: r.h * zoom,
                          borderColor: r.color,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.id);
                        }}
                      >
                        <span className="uim-box__label" style={{ background: r.color }}>
                          {r.name || '—'}
                        </span>
                      </div>
                    ))}
                    {drawing && previewStyle && <div className="uim-preview" style={previewStyle} />}
                  </div>
                </div>
              </div>

              <div className="uim-table-wrap">
                <table className="uim-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th>X</th>
                      <th>Y</th>
                      <th>W</th>
                      <th>H</th>
                      <th>nX</th>
                      <th>nY</th>
                      <th>nW</th>
                      <th>nH</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((r) => (
                      <tr
                        key={r.id}
                        className={selectedId === r.id ? 'uim-row--sel' : ''}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <td>
                          <span className="uim-swatch" style={{ background: r.color }} />
                        </td>
                        <td>
                          <input
                            value={r.name}
                            onChange={(e) => renameRegion(r.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>{Math.round(r.x)}</td>
                        <td>{Math.round(r.y)}</td>
                        <td>{Math.round(r.w)}</td>
                        <td>{Math.round(r.h)}</td>
                        <td>{(r.x / image.naturalWidth).toFixed(3)}</td>
                        <td>{(r.y / image.naturalHeight).toFixed(3)}</td>
                        <td>{(r.w / image.naturalWidth).toFixed(3)}</td>
                        <td>{(r.h / image.naturalHeight).toFixed(3)}</td>
                        <td>
                          <button
                            type="button"
                            className="uim-del"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRegion(r.id);
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {regions.length === 0 && (
                  <p className="uim-empty">No boxes yet — drag on the image to draw one.</p>
                )}
              </div>
            </>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
