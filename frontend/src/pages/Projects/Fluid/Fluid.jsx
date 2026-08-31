import React, { useEffect, useRef, useState } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { FluidSolver } from './fluidSolver';
import './Fluid.css';

// Paint colors (r, g, b in 0..1). The Rainbow swatch is a sentinel (r: -1)
// whose color is derived from time so each splat lands on a new hue.
const COLORS = [
  { name: 'Cyan', r: 0.25, g: 0.85, b: 1 },
  { name: 'Pink', r: 1, g: 0.35, b: 0.75 },
  { name: 'Orange', r: 1, g: 0.6, b: 0.2 },
  { name: 'Mint', r: 0.35, g: 1, b: 0.6 },
  { name: 'Violet', r: 0.7, g: 0.45, b: 1 },
  { name: 'Gold', r: 1, g: 0.95, b: 0.3 },
];

function hueToRgb(h) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  switch (i % 6) {
    case 0: return { r: 1, g: f, b: 0 };
    case 1: return { r: q, g: 1, b: 0 };
    case 2: return { r: 0, g: 1, b: f };
    case 3: return { r: 0, g: q, b: 1 };
    case 4: return { r: f, g: 0, b: 1 };
    default: return { r: 1, g: 0, b: q };
  }
}

function Fluid() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Refs read inside the animation loop (avoids re-creating the loop on
  // state changes).
  const solverRef = useRef(null);
  const offRef = useRef(null);
  const imgRef = useRef(null);
  const bgGradRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const timeRef = useRef(0);
  const seededRef = useRef(false);
  const pointerRef = useRef({ down: false, x: 0, y: 0 });
  const colorRef = useRef({ rainbow: false, r: COLORS[0].r, g: COLORS[0].g, b: COLORS[0].b });
  const pausedRef = useRef(false);
  const autoplayRef = useRef(true);

  const [colorIndex, setColorIndex] = useState(0);
  const [rainbow, setRainbow] = useState(false);
  const [paused, setPaused] = useState(false);
  const [autoplay, setAutoplay] = useState(true);

  // Keep refs in sync with React state.
  useEffect(() => {
    colorRef.current = rainbow
      ? { rainbow: true, r: 0, g: 0, b: 0 }
      : { rainbow: false, r: COLORS[colorIndex].r, g: COLORS[colorIndex].g, b: COLORS[colorIndex].b };
  }, [colorIndex, rainbow]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { autoplayRef.current = autoplay; }, [autoplay]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });

    let simW = 0;
    let simH = 0;

    const setup = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(320, rect.width);
      const cssH = Math.max(320, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      // ~150 cells across the widest edge, capped so the solver stays fast.
      let cell = Math.max(4, cssW / 150);
      simW = Math.max(16, Math.floor(cssW / cell));
      simH = Math.max(16, Math.floor(cssH / cell));
      const maxCells = 280 * 180;
      while (simW * simH > maxCells && cell < 32) {
        cell *= 1.5;
        simW = Math.max(16, Math.floor(cssW / cell));
        simH = Math.max(16, Math.floor(cssH / cell));
      }

      solverRef.current = new FluidSolver(simW, simH, {
        dt: 0.04,
        iter: 8,
        vorticity: 0.6,
        dissipation: 0.985,
      });

      const off = document.createElement('canvas');
      off.width = simW;
      off.height = simH;
      offRef.current = off;
      imgRef.current = off.getContext('2d').createImageData(simW, simH);

      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, '#0c1226');
      g.addColorStop(1, '#03050a');
      bgGradRef.current = g;
    };

    setup();

    const resizeObserver = new ResizeObserver(() => setup());
    resizeObserver.observe(wrap);

    // ── Pointer interaction ──────────────────────────────────────────────
    const cellFromEvent = (e) => {
      const s = solverRef.current;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * s.w,
        y: ((e.clientY - rect.top) / rect.height) * s.h,
      };
    };

    const paintColor = () => {
      const c = colorRef.current;
      if (c.rainbow) return hueToRgb((timeRef.current * 0.6) % 1);
      return c;
    };

    const splatAt = (x, y, amount) => {
      const s = solverRef.current;
      const c = paintColor();
      s.splat(x, y, c.r, c.g, c.b, 5, amount);
    };

    const onDown = (e) => {
      const s = solverRef.current;
      if (!s) return;
      const { x, y } = cellFromEvent(e);
      pointerRef.current = { down: true, x, y };
      splatAt(x, y, 1.0);
    };

    const onMove = (e) => {
      const s = solverRef.current;
      const p = pointerRef.current;
      if (!s || !p.down) return;
      const { x, y } = cellFromEvent(e);
      const dx = x - p.x;
      const dy = y - p.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.min(8, Math.max(1, Math.ceil(dist / 3)));
      for (let i = 1; i <= steps; i++) {
        const ix = p.x + dx * (i / steps);
        const iy = p.y + dy * (i / steps);
        s.addForce(ix, iy, dx * 1.2, dy * 1.2, 4);
        splatAt(ix, iy, 0.55);
      }
      p.x = x;
      p.y = y;
    };

    const onUp = () => { pointerRef.current.down = false; };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.style.touchAction = 'none';

    // ── Idle "stirring" so the fluid stays alive without input ──────────
    const idle = () => {
      if (!autoplayRef.current || pointerRef.current.down || pausedRef.current) return;
      const s = solverRef.current;
      const t = timeRef.current;
      const cx = s.w * 0.5;
      const cy = s.h * 0.5;
      const r = Math.min(s.w, s.h) * 0.32;
      const a1 = t * 0.5;
      const a2 = -t * 0.35 + 2;
      s.addForce(
        cx + Math.cos(a1) * r,
        cy + Math.sin(a1) * r,
        -Math.sin(a1) * 2.5,
        Math.cos(a1) * 2.5,
        6
      );
      s.addForce(
        cx + Math.cos(a2) * r * 0.6,
        cy + Math.sin(a2) * r * 0.6,
        -Math.sin(a2) * 2.5,
        Math.cos(a2) * 2.5,
        6
      );
    };

    const seed = () => {
      const s = solverRef.current;
      const seeds = [
        [0.5, 0.5, 0.25, 0.85, 1],
        [0.35, 0.4, 1, 0.35, 0.75],
        [0.65, 0.6, 0.35, 1, 0.6],
        [0.45, 0.65, 1, 0.6, 0.2],
      ];
      for (const [fx, fy, r, g, b] of seeds) {
        s.splat(s.w * fx, s.h * fy, r, g, b, 14, 2.0);
      }
      seededRef.current = true;
    };

    // ── Render + main loop ───────────────────────────────────────────────
    const render = () => {
      const s = solverRef.current;
      const off = offRef.current;
      const img = imgRef.current;
      if (!s || !off || !img) return;

      const data = img.data;
      const dye = s.dye;
      const total = s.w * s.h;
      for (let i = 0; i < total; i++) {
        const i3 = i * 3;
        const i4 = i * 4;
        let r = dye[i3] * 255;
        let g = dye[i3 + 1] * 255;
        let b = dye[i3 + 2] * 255;
        data[i4] = r > 255 ? 255 : r;
        data[i4 + 1] = g > 255 ? 255 : g;
        data[i4 + 2] = b > 255 ? 255 : b;
        data[i4 + 3] = 255;
      }
      off.getContext('2d').putImageData(img, 0, 0);

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bgGradRef.current || '#05070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = 'source-over';
    };

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastRef.current) / 1000 || 0.016);
      lastRef.current = now;
      timeRef.current += dt;

      if (!pausedRef.current) {
        if (!seededRef.current) seed();
        idle();
        solverRef.current.step();
      }
      render();
    };

    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const selectColor = (index) => {
    setRainbow(false);
    setColorIndex(index);
  };

  return (
    <>
      <SEO
        title="Fluid"
        description="Paint glowing, mouse-reactive fluid that swirls and flows in real time — a free interactive incompressible fluid simulation running right in your browser."
        path="/fluid"
      />
      <Header />
      <div className="fluid">
        <div className="fluid-ambient" aria-hidden="true">
          <span className="fluid-orb fluid-orb--1" />
          <span className="fluid-orb fluid-orb--2" />
          <span className="fluid-orb fluid-orb--3" />
        </div>
        <div className="fluid-section">
          <div className="fluid-title-wrap">
            <p className="fluid-eyebrow">Interactive · In-browser simulation</p>
            <h1 className="fluid-title">Fluid</h1>
            <div className="fluid-underline" aria-hidden="true" />
            <p className="fluid-subtitle">
              Click or drag across the canvas to inject glowing fluid and push it around. A real-time
              Navier–Stokes solver runs entirely in your browser — no GPU, no server, just pixels and physics.
            </p>
            <ul className="fluid-tags" aria-label="Highlights">
              <li>Real-time</li>
              <li>No GPU needed</li>
              <li>Touch-friendly</li>
            </ul>
          </div>

          <div className="fluid-card">
            <div className="fluid-card__bar">
              <span className="fluid-card__bar-title">Simulation</span>
              <span className={`fluid-live${paused ? ' fluid-live--paused' : ''}`}>
                <span className="fluid-live__dot" aria-hidden="true" />
                {paused ? 'Paused' : 'Live'}
              </span>
            </div>
            <div className="fluid-controls" role="group" aria-label="Fluid controls">
              <div className="fluid-swatches" aria-label="Paint color">
                {COLORS.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    title={c.name}
                    aria-label={`Paint with ${c.name}`}
                    className={`fluid-swatch${!rainbow && colorIndex === i ? ' active' : ''}`}
                    style={{ background: `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})` }}
                    onClick={() => selectColor(i)}
                  />
                ))}
                <button
                  type="button"
                  title="Rainbow"
                  aria-label="Rainbow paint"
                  className={`fluid-swatch fluid-swatch--rainbow${rainbow ? ' active' : ''}`}
                  onClick={() => { setRainbow(true); }}
                />
              </div>

              <div className="fluid-actions">
                <button
                  type="button"
                  className={`fluid-btn${autoplay ? ' on' : ''}`}
                  onClick={() => setAutoplay((v) => !v)}
                >
                  {autoplay ? '◉ Auto-play: on' : '○ Auto-play: off'}
                </button>
                <button
                  type="button"
                  className="fluid-btn"
                  onClick={() => setPaused((v) => !v)}
                >
                  {paused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button
                  type="button"
                  className="fluid-btn"
                  onClick={() => {
                    if (solverRef.current) {
                      solverRef.current.u.fill(0);
                      solverRef.current.v.fill(0);
                      solverRef.current.u0.fill(0);
                      solverRef.current.v0.fill(0);
                      solverRef.current.dye.fill(0);
                      solverRef.current.dye0.fill(0);
                      seededRef.current = false;
                    }
                  }}
                >
                  ✕ Clear
                </button>
              </div>
            </div>

            <div className="fluid-canvas-wrap" ref={wrapRef}>
              <canvas ref={canvasRef} className="fluid-canvas" aria-label="Interactive fluid simulation" />
            </div>

            <p className="fluid-hint">
              Drag to swirl · click to splat · pick a color to change the ink. Best with a mouse or touchscreen.
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Fluid;
