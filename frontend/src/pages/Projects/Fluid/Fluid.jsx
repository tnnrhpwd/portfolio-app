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
  const lumRef = useRef(null);
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

      // ~230 cells across the widest edge, capped so the solver stays fast.
      let cell = Math.max(4, cssW / 230);
      simW = Math.max(16, Math.floor(cssW / cell));
      simH = Math.max(16, Math.floor(cssH / cell));
      const maxCells = 380 * 240;
      while (simW * simH > maxCells && cell < 32) {
        cell *= 1.5;
        simW = Math.max(16, Math.floor(cssW / cell));
        simH = Math.max(16, Math.floor(cssH / cell));
      }

      solverRef.current = new FluidSolver(simW, simH, {
        dt: 0.04,
        iter: 8,
        vorticity: 0.32,
        dissipation: 0.997,
        viscosity: 0.0002,
        diffusion: 0.00005,
      });

      // A brand-new solver has no ink — re-seed it once the first frame
      // runs (a ResizeObserver callback can recreate the solver at any
      // time, including right after mount).
      seededRef.current = false;

      const off = document.createElement('canvas');
      off.width = simW;
      off.height = simH;
      offRef.current = off;
      imgRef.current = off.getContext('2d').createImageData(simW, simH);
      lumRef.current = new Float32Array(simW * simH);

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

    // ── Idle "currents" so the fluid keeps flowing without input ────────
    // Two counter-rotating swirls around the centre (with a slow wander) so
    // the fluid circulates organically without drifting off to one side.
    const idle = () => {
      if (!autoplayRef.current || pointerRef.current.down || pausedRef.current) return;
      const s = solverRef.current;
      const t = timeRef.current;
      const min = Math.min(s.w, s.h);
      const cx = s.w * 0.5;
      const cy = s.h * 0.5;
      const r1 = min * 0.34;
      const r2 = min * 0.2;
      const a1 = t * 0.45;
      const a2 = -t * 0.33 + 2.1;
      // Slow wander of the swirl centre so the motion stays organic.
      const wob = Math.sin(t * 0.07) * 0.04;
      s.addForce(
        cx + Math.cos(a1) * r1,
        cy + Math.sin(a1) * r1,
        -Math.sin(a1) * 1.6,
        Math.cos(a1) * 1.6,
        Math.max(5, r1 * 0.5)
      );
      s.addForce(
        cx + Math.cos(a2) * r2 + wob * s.w,
        cy + Math.sin(a2) * r2 + wob * s.h,
        -Math.sin(a2) * 1.6,
        Math.cos(a2) * 1.6,
        Math.max(4, r2 * 0.5)
      );
    };

    // ── Continuous dye source ─────────────────────────────────────────────
    // A slowly drifting "spring" keeps injecting fresh pigment so the fluid
    // never fades out, even with no pointer input.
    const source = () => {
      if (!autoplayRef.current || pointerRef.current.down || pausedRef.current) return;
      const s = solverRef.current;
      const t = timeRef.current;
      const c = paintColor();
      const fx = 0.5 + Math.sin(t * 0.09) * 0.32;
      const fy = 0.5 + Math.cos(t * 0.12) * 0.28;
      const x = fx * s.w;
      const y = fy * s.h;
      s.splat(x, y, c.r, c.g, c.b, 7, 0.5);
      // Gentle radial push so the fresh ink actually flows outward.
      s.addForce(x, y, Math.cos(t * 0.6) * 1.5, Math.sin(t * 0.6) * 1.5, 7);
    };

    const seed = () => {
      const s = solverRef.current;
      const seeds = [
        [0.5, 0.5, 0.25, 0.85, 1],    // cyan
        [0.32, 0.38, 0.3, 0.55, 1],   // blue
        [0.68, 0.6, 0.7, 0.45, 1],    // violet
        [0.42, 0.68, 1, 0.4, 0.85],   // magenta
        [0.6, 0.28, 0.2, 0.9, 0.9],   // azure
      ];
      for (const [fx, fy, r, g, b] of seeds) {
        s.splat(s.w * fx, s.h * fy, r, g, b, 16, 1.8);
      }
      seededRef.current = true;
    };

    // ── Render + main loop ───────────────────────────────────────────────
    const render = () => {
      const s = solverRef.current;
      const off = offRef.current;
      const img = imgRef.current;
      const lum = lumRef.current;
      if (!s || !off || !img || !lum) return;

      const { w, h, dye } = s;
      const data = img.data;
      const total = w * h;

      // Treat dye density (mean of RGB) as the height of a fluid surface;
      // its gradient gives a surface normal we can light.
      for (let i = 0; i < total; i++) {
        const i3 = i * 3;
        lum[i] = (dye[i3] + dye[i3 + 1] + dye[i3 + 2]) * 0.33333334;
      }

      // Key light from the upper-left, slightly toward the viewer, plus a
      // fixed half-vector for a glossy specular term.
      const lInv = 1 / Math.hypot(0.38, -0.5, 0.78);
      const lx = 0.38 * lInv, ly = -0.5 * lInv, lz = 0.78 * lInv;
      const hInv = 1 / Math.hypot(0.18, -0.24, 0.95);
      const Hx = 0.18 * hInv, Hy = -0.24 * hInv, Hz = 0.95 * hInv;

      const ambient = 0.12;
      const diffuse = 1.05;
      const specular = 0.55;
      const shininess = 30;
      const densityScale = 2.8;

      for (let y = 0; y < h; y++) {
        const row = y * w;
        const rowU = (y > 0 ? y - 1 : 0) * w;
        const rowD = (y < h - 1 ? y + 1 : h - 1) * w;
        for (let x = 0; x < w; x++) {
          const i = row + x;
          const d = lum[i];
          const i3 = i * 3;
          const i4 = i * 4;
          if (d < 0.002) {
            data[i4] = 0; data[i4 + 1] = 0; data[i4 + 2] = 0; data[i4 + 3] = 0;
            continue;
          }
          const xL = x > 0 ? x - 1 : 0;
          const xR = x < w - 1 ? x + 1 : w - 1;

          // Central-difference gradient of the density field (3-tap for a
          // smoother normal than a raw one-sided difference).
          const gx = lum[rowU + xR] + lum[row + xR] + lum[rowD + xR]
                   - lum[rowU + xL] - lum[row + xL] - lum[rowD + xL];
          const gy = lum[rowD + xL] + lum[rowD + x] + lum[rowD + xR]
                   - lum[rowU + xL] - lum[rowU + x] - lum[rowU + xR];

          const invN = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          const nx = -gx * invN;
          const ny = -gy * invN;
          const nz = invN;

          let ndl = nx * lx + ny * ly + nz * lz;
          if (ndl < 0) ndl = 0;
          let ndh = nx * Hx + ny * Hy + nz * Hz;
          if (ndh < 0) ndh = 0;
          const spec = Math.pow(ndh, shininess) * specular * (1 - Math.exp(-d * 3));

          // Normalized hue (colour independent of density) so pigment keeps
          // its identity as it concentrates or thins.
          const maxC = Math.max(dye[i3], dye[i3 + 1], dye[i3 + 2]);
          const invMax = 1 / (maxC + 1e-5);
          const cr = dye[i3] * invMax;
          const cg = dye[i3 + 1] * invMax;
          const cb = dye[i3 + 2] * invMax;

          const shade = (ambient + ndl * diffuse) * densityScale;
          // Beer–Lambert-ish tone mapping: dense dye saturates, thin wisps
          // stay translucent — instead of the old flat additive glow.
          const lit = 1 - Math.exp(-maxC * shade);
          const alpha = 1 - Math.exp(-d * 3.6);

          data[i4]     = Math.min(255, cr * lit * 255 + spec * 255);
          data[i4 + 1] = Math.min(255, cg * lit * 255 + spec * 255);
          data[i4 + 2] = Math.min(255, cb * lit * 255 + spec * 255);
          data[i4 + 3] = alpha * 255;
        }
      }
      off.getContext('2d').putImageData(img, 0, 0);

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bgGradRef.current || '#05070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Soft bloom: a blurred additive pass under the crisp fluid gives the
      // highlights a gentle halo, like light scattering through liquid.
      const blur = Math.max(3, canvas.width / 200);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3;
      ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;

      // Crisp fluid pass on top.
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    };

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastRef.current) / 1000 || 0.016);
      lastRef.current = now;
      timeRef.current += dt;

      if (!pausedRef.current) {
        if (!seededRef.current) seed();
        idle();
        source();
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
              Click or drag to inject pigment and push it around. A real-time Navier–Stokes solver
              simulates incompressible flow, then shades the density like a lit liquid surface —
              no GPU, no server, just pixels and physics.
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
              Drag to swirl · click to splat · pick a color to change the pigment. Watch the light catch the
              surface as it settles. Best with a mouse or touchscreen.
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Fluid;
