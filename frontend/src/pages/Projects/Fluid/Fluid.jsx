import React, { useEffect, useRef, useState } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import './Fluid.css';

// ── Elements ─────────────────────────────────────────────────────────────
const E = {
  EMPTY: 0,
  WALL: 1,
  SAND: 2,
  WATER: 3,
  OIL: 4,
  SALT: 5,
  FIRE: 6,
  GAS: 7,
  SEED: 8,
  PLANT: 9,
  WOOD: 10,
  STONE: 11,
  LAVA: 12,
  ACID: 13,
  GUNPOWDER: 14,
  NITRO: 15,
  C4: 16,
  ICE: 17,
  METAL: 18,
  STEAM: 19,
  TORCH: 20,
  VIRUS: 21,
  ANT: 22,
  PLAYER: 23,
  VINE: 24,
  MERCURY: 25,
  GLASS: 26,
  ERASER: 255,
};

const FIRE_LIFE = 90;
const GAS_LIFE = 160;
const STEAM_LIFE = 120;
const ACID_LIFE = 100;
const LAVA_LIFE = 900; // frames before lava cools into stone
// Frames a cell must rest after a density swap before it can sink again.
const REST_FRAMES = 4;

// ── Density / buoyancy ───────────────────────────────────────────────────
const DENSITY = {
  [E.STEAM]: 0.2,
  [E.GAS]: 0.3,
  [E.FIRE]: 0.4,
  [E.OIL]: 0.8,
  [E.WATER]: 1.0,
  [E.ACID]: 1.05,
  [E.TORCH]: 1.0,
  [E.SALT]: 1.2,
  [E.SEED]: 1.3,
  [E.PLANT]: 1.4,
  [E.VINE]: 1.4,
  [E.SAND]: 1.5,
  [E.GUNPOWDER]: 1.6,
  [E.NITRO]: 1.7,
  [E.LAVA]: 2.5,
  [E.GLASS]: 2.5,
  [E.STONE]: 2.6,
  [E.METAL]: 7.9,
  [E.MERCURY]: 13.6,
  [E.WALL]: Infinity,
};

const isLiquid = (e) =>
  e === E.WATER || e === E.OIL || e === E.NITRO || e === E.LAVA || e === E.ACID || e === E.MERCURY;

const isDisplaceable = (e) =>
  e === E.WATER || e === E.OIL || e === E.SALT || e === E.SAND || e === E.SEED
  || e === E.GUNPOWDER || e === E.NITRO || e === E.LAVA || e === E.ACID
  || e === E.MERCURY || e === E.GAS || e === E.STEAM;

const isMobile = (e) => isDisplaceable(e) || e === E.FIRE || e === E.ANT;

const isPowder = (e) => e === E.SAND || e === E.SALT || e === E.GUNPOWDER || e === E.SEED;

const isExplosive = (e) => e === E.GUNPOWDER || e === E.NITRO || e === E.C4;
const explosiveRadius = (e) => (e === E.C4 ? 15 : e === E.NITRO ? 10 : 7);

// Heat emitted by hot materials (0..1). Drives boiling, melting, ignition.
const HEAT_SOURCE = {
  [E.FIRE]: 1.0,
  [E.LAVA]: 0.9,
  [E.TORCH]: 0.85,
};

// Base render colors (used by the 2D fallback; the WebGL shader has its own).
const COLORS = {
  [E.WALL]: [70, 76, 90],
  [E.SAND]: [231, 198, 126],
  [E.WATER]: [54, 130, 246],
  [E.OIL]: [140, 96, 46],
  [E.SALT]: [236, 236, 242],
  [E.GAS]: [190, 148, 255],
  [E.SEED]: [146, 193, 82],
  [E.PLANT]: [67, 170, 82],
  [E.VINE]: [78, 205, 96],
  [E.WOOD]: [139, 90, 43],
  [E.STONE]: [122, 128, 140],
  [E.LAVA]: [255, 96, 32],
  [E.ACID]: [178, 255, 58],
  [E.GUNPOWDER]: [58, 58, 66],
  [E.NITRO]: [34, 156, 82],
  [E.C4]: [224, 176, 80],
  [E.ICE]: [174, 219, 242],
  [E.METAL]: [154, 164, 177],
  [E.STEAM]: [223, 232, 240],
  [E.VIRUS]: [34, 197, 94],
  [E.ANT]: [164, 62, 42],
  [E.MERCURY]: [190, 198, 210],
  [E.GLASS]: [172, 220, 236],
};

const ELEMENTS = [
  { id: E.SAND, name: 'Sand', color: '#e7c67e' },
  { id: E.WATER, name: 'Water', color: '#3682f6' },
  { id: E.OIL, name: 'Oil', color: '#8c602e' },
  { id: E.MERCURY, name: 'Mercury', color: '#bec6d2' },
  { id: E.SALT, name: 'Salt', color: '#ececf2' },
  { id: E.ICE, name: 'Ice', color: '#aedbf2' },
  { id: E.STEAM, name: 'Steam', color: '#dfe8f0' },
  { id: E.FIRE, name: 'Fire', color: '#ff7a1f' },
  { id: E.GAS, name: 'Gas', color: '#be94ff' },
  { id: E.TORCH, name: 'Torch', color: '#ffd54a' },
  { id: E.LAVA, name: 'Lava', color: '#ff601f' },
  { id: E.ACID, name: 'Acid', color: '#b2ff3a' },
  { id: E.GUNPOWDER, name: 'Gunpowder', color: '#3a3a42' },
  { id: E.NITRO, name: 'Nitro', color: '#229c52' },
  { id: E.C4, name: 'C-4', color: '#e0b050' },
  { id: E.SEED, name: 'Seed', color: '#92c152' },
  { id: E.PLANT, name: 'Plant', color: '#43aa52' },
  { id: E.VINE, name: 'Vine', color: '#4ecd60' },
  { id: E.WOOD, name: 'Wood', color: '#8b5a2b' },
  { id: E.GLASS, name: 'Glass', color: '#acdcec' },
  { id: E.METAL, name: 'Metal', color: '#9aa4b1' },
  { id: E.STONE, name: 'Stone', color: '#7a808c' },
  { id: E.VIRUS, name: 'Virus', color: '#22c55e' },
  { id: E.ANT, name: 'Ant', color: '#a43e2a' },
  { id: E.PLAYER, name: 'Player', color: '#6ee7ff' },
  { id: E.WALL, name: 'Wall', color: '#464c5a' },
  { id: E.ERASER, name: 'Erase', color: null },
];

const BRUSHES = [
  { value: 1, label: 'S', px: 8 },
  { value: 2, label: 'M', px: 16 },
  { value: 4, label: 'L', px: 32 },
  { value: 6, label: 'XL', px: 48 },
];

function fireColor(life) {
  if (life > 72) return [255, 252, 220];
  if (life > 44) return [255, 190, 64];
  if (life > 18) return [255, 116, 28];
  return [214, 52, 20];
}

function Fluid() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const simRef = useRef(null);
  const rafRef = useRef(0);
  const pointerRef = useRef({ down: false, x: 0, y: 0 });

  const [tool, setTool] = useState(E.SAND);
  const [brush, setBrush] = useState(2);
  const [paused, setPaused] = useState(false);

  const toolRef = useRef(E.SAND);
  const brushRef = useRef(2);
  const pausedRef = useRef(false);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { brushRef.current = brush; }, [brush]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

    const CELL = 4;
    let lastW = 0;
    let lastH = 0;

    // ── Renderer selection ────────────────────────────────────────────────
    let gl = null;
    let ctx2d = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, premultipliedAlpha: false,
        depth: false, stencil: false, preserveDrawingBuffer: false,
      });
    } catch (err) { gl = null; }
    if (gl) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // WebGL texture rows are bottom-up; flip so grid row 0 (the top) lands at the top.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }
    if (!gl) ctx2d = canvas.getContext('2d', { alpha: false });

    const overlayCtx = overlay.getContext('2d');

    // ── WebGL helpers ─────────────────────────────────────────────────────
    const compileShader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const linkProgram = (vsSrc, fsSrc) => {
      const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
      }
      return p;
    };
    const makeTex = (w, h, internal, format, type, filter) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      return tex;
    };
    const makeFBO = (attachments) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      attachments.forEach((tex, i) => {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      });
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer incomplete');
      }
      return fbo;
    };

    const VS = `#version 300 es
      out vec2 vUv;
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        vUv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`;

    // Shared GLSL: cell decode, palette, categories, lighting, liquid shape.
    const COMMON = `
      int cellId(vec2 uv) { return int(texture(uCells, uv).r * 255.0 + 0.5); }
      float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      vec3 baseColor(int id) {
        if (id == 1) return vec3(0.27,0.30,0.35);
        if (id == 2) return vec3(0.91,0.78,0.49);
        if (id == 3) return vec3(0.21,0.51,0.96);
        if (id == 4) return vec3(0.55,0.38,0.18);
        if (id == 5) return vec3(0.93,0.93,0.95);
        if (id == 6) return vec3(1.00,0.48,0.12);
        if (id == 7) return vec3(0.75,0.58,1.00);
        if (id == 8) return vec3(0.57,0.76,0.32);
        if (id == 9) return vec3(0.26,0.67,0.32);
        if (id == 10) return vec3(0.55,0.35,0.17);
        if (id == 11) return vec3(0.48,0.50,0.55);
        if (id == 12) return vec3(1.00,0.38,0.13);
        if (id == 13) return vec3(0.70,1.00,0.23);
        if (id == 14) return vec3(0.23,0.23,0.26);
        if (id == 15) return vec3(0.13,0.61,0.32);
        if (id == 16) return vec3(0.88,0.69,0.31);
        if (id == 17) return vec3(0.68,0.86,0.95);
        if (id == 18) return vec3(0.60,0.64,0.69);
        if (id == 19) return vec3(0.87,0.91,0.94);
        if (id == 20) return vec3(1.00,0.83,0.29);
        if (id == 21) return vec3(0.13,0.77,0.37);
        if (id == 22) return vec3(0.64,0.24,0.16);
        if (id == 24) return vec3(0.31,0.80,0.38);
        if (id == 25) return vec3(0.75,0.78,0.82);
        if (id == 26) return vec3(0.67,0.86,0.93);
        return vec3(1.0,0.0,1.0);
      }
      bool isLiquid(int id) {
        return id == 3 || id == 4 || id == 25 || id == 13 || id == 15 || id == 12;
      }
      bool isGasLike(int id) { return id == 7 || id == 19; }
      bool isEmissive(int id) { return id == 6 || id == 12 || id == 20; }
      float shading(vec2 uv) {
        float hL = cellId(uv - vec2(uTexel.x, 0.0)) != 0 ? 1.0 : 0.0;
        float hR = cellId(uv + vec2(uTexel.x, 0.0)) != 0 ? 1.0 : 0.0;
        float hD = cellId(uv - vec2(0.0, uTexel.y)) != 0 ? 1.0 : 0.0;
        float hU = cellId(uv + vec2(0.0, uTexel.y)) != 0 ? 1.0 : 0.0;
        vec3 n = normalize(vec3(hL - hR, hD - hU, 2.2));
        float d = dot(n, normalize(vec3(-0.5, 0.8, 0.6)));
        return 0.35 + 0.65 * max(d, 0.0);
      }
      float liquidCoverage(int id) {
        vec2 cell = vUv * uGridSize;
        vec2 f = fract(cell);
        bool up = cellId(vUv + vec2(0.0, uTexel.y)) == id;
        bool dn = cellId(vUv - vec2(0.0, uTexel.y)) == id;
        bool lf = cellId(vUv - vec2(uTexel.x, 0.0)) == id;
        bool rt = cellId(vUv + vec2(uTexel.x, 0.0)) == id;
        float x0 = lf ? 0.0 : 0.5;
        float x1 = rt ? 1.0 : 0.5;
        float y0 = dn ? 0.0 : 0.5;
        float y1 = up ? 1.0 : 0.5;
        vec2 c = vec2((x0 + x1) * 0.5, (y0 + y1) * 0.5);
        vec2 b = vec2(abs(x1 - x0) * 0.5, abs(y1 - y0) * 0.5);
        float r = min(b.x, b.y) * 0.6;
        vec2 q = abs(f - c) - (b - vec2(r));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        return 1.0 - smoothstep(-0.16, 0.16, d);
      }`;

    const SCENE_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uCells;
      uniform sampler2D uHeat;
      uniform vec2 uTexel;
      uniform vec2 uGridSize;
      uniform float uTime;
      ${COMMON}
      vec3 background() {
        float t = uTime;
        vec2 p = vUv;
        vec3 top = vec3(0.05, 0.06, 0.13);
        vec3 bot = vec3(0.09, 0.04, 0.12);
        vec3 col = mix(bot, top, p.y);
        float a = sin(p.x * 4.0 + t * 0.12) * 0.5 + 0.5;
        float b = cos(p.y * 3.0 - t * 0.09) * 0.5 + 0.5;
        col += vec3(0.045, 0.025, 0.085) * a;
        col += vec3(0.025, 0.05, 0.06) * b;
        float heat = texture(uHeat, vUv).r;
        col += vec3(0.34, 0.17, 0.06) * smoothstep(0.25, 0.85, heat) * 0.5;
        return col;
      }
      void main() {
        int id = cellId(vUv);
        vec3 bg = background();
        if (id == 0) { fragColor = vec4(bg, 1.0); return; }
        vec3 col = baseColor(id);
        if (isLiquid(id)) {
          float cov = liquidCoverage(id);
          vec3 lit = col * shading(vUv);
          col = mix(bg, lit, cov);
        } else if (id == 6) {
          float hh = hash21(floor(vUv * uGridSize));
          col = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.95, 0.80), hh);
        } else if (id == 20) {
          col = vec3(1.0, 0.85, 0.40);
        } else if (id == 12) {
          float hh = hash21(floor(vUv * uGridSize));
          col = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.75, 0.30), hh);
        } else if (isGasLike(id)) {
          float hh = hash21(floor(vUv * uGridSize));
          col = mix(bg, col, 0.45 + 0.25 * hh);
        } else {
          float sh = shading(vUv);
          col *= sh;
          if (id == 18) col += vec3(0.25, 0.28, 0.32) * pow(sh, 8.0);
          if (id == 26) col = mix(col, vec3(0.9, 0.97, 1.0), 0.12);
        }
        fragColor = vec4(col, 1.0);
      }`;

    const GLOW_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uCells;
      uniform sampler2D uHeat;
      uniform vec2 uTexel;
      uniform vec2 uGridSize;
      ${COMMON}
      void main() {
        int id = cellId(vUv);
        if (id == 0) { fragColor = vec4(0.0); return; }
        float heat = texture(uHeat, vUv).r;
        float amt = smoothstep(0.35, 0.95, heat);
        if (isEmissive(id)) amt = max(amt, 0.85);
        vec3 col = baseColor(id);
        if (id == 6) col = vec3(1.0, 0.55, 0.15);
        if (id == 12) col = vec3(1.0, 0.35, 0.08);
        if (id == 20) col = vec3(1.0, 0.80, 0.30);
        fragColor = vec4(col * amt * 1.2, 1.0);
      }`;

    const BLUR_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uTex;
      uniform vec2 uDir;
      void main() {
        vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
        s += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
        s += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
        s += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
        s += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
        fragColor = vec4(s, 1.0);
      }`;

    const COMP_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uScene;
      uniform sampler2D uBloom;
      uniform float uStrength;
      void main() {
        vec3 scene = texture(uScene, vUv).rgb;
        vec3 bloom = texture(uBloom, vUv).rgb;
        vec3 col = scene + bloom * uStrength;
        float d = length(vUv - 0.5);
        col *= 1.0 - smoothstep(0.45, 0.85, d) * 0.35;
        fragColor = vec4(col, 1.0);
      }`;

    let P = null; // programs + uniforms
    let glRes = null; // textures + fbos
    let vao = null;

    const initGL = () => {
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const mainProg = linkProgram(VS, SCENE_FS);
      const glowProg = linkProgram(VS, GLOW_FS);
      const blurProg = linkProgram(VS, BLUR_FS);
      const compProg = linkProgram(VS, COMP_FS);
      const uni = (p, n) => gl.getUniformLocation(p, n);
      P = {
        mainProg, glowProg, blurProg, compProg,
        main: { uCells: uni(mainProg, 'uCells'), uHeat: uni(mainProg, 'uHeat'),
          uTexel: uni(mainProg, 'uTexel'), uGridSize: uni(mainProg, 'uGridSize'),
          uTime: uni(mainProg, 'uTime') },
        glow: { uCells: uni(glowProg, 'uCells'), uHeat: uni(glowProg, 'uHeat'),
          uTexel: uni(glowProg, 'uTexel'), uGridSize: uni(glowProg, 'uGridSize') },
        blur: { uTex: uni(blurProg, 'uTex'), uDir: uni(blurProg, 'uDir') },
        comp: { uScene: uni(compProg, 'uScene'), uBloom: uni(compProg, 'uBloom'),
          uStrength: uni(compProg, 'uStrength') },
      };
    };

    const ensureGLResources = (w, h) => {
      if (!gl) return;
      if (glRes) {
        [glRes.cellTex, glRes.heatTex, glRes.sceneTex, glRes.glowTex,
          glRes.blurATex, glRes.blurBTex].forEach((t) => gl.deleteTexture(t));
        [glRes.sceneFBO, glRes.blurAFBO, glRes.blurBFBO].forEach((f) => gl.deleteFramebuffer(f));
      }
      const bw = Math.max(1, w >> 1);
      const bh = Math.max(1, h >> 1);
      glRes = {
        w, h, bw, bh,
        cellTex: makeTex(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST),
        heatTex: makeTex(w, h, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST),
        sceneTex: makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR),
        glowTex: makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR),
        blurATex: makeTex(bw, bh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR),
        blurBTex: makeTex(bw, bh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR),
        sceneFBO: null, blurAFBO: null, blurBFBO: null,
      };
      glRes.sceneFBO = makeFBO([glRes.sceneTex]);
      glRes.glowFBO = makeFBO([glRes.glowTex]);
      glRes.blurAFBO = makeFBO([glRes.blurATex]);
      glRes.blurBFBO = makeFBO([glRes.blurBTex]);
    };

    if (gl) {
      try { initGL(); } catch (err) { console.error('Fluid: WebGL init failed', err); gl = null; ctx2d = null; }
      // If init failed we can't get a 2D context on this canvas; degrade to clear.
    }

    // ── Simulation setup ──────────────────────────────────────────────────
    const setup = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(320, rect.width);
      const cssH = Math.max(320, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      overlay.width = canvas.width;
      overlay.height = canvas.height;

      const w = Math.max(16, Math.floor(cssW / CELL));
      const h = Math.max(16, Math.floor(cssH / CELL));
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;

      const cells = new Uint8Array(w * h);
      const life = new Float32Array(w * h);
      const moved = new Uint8Array(w * h);
      const rest = new Uint8Array(w * h);
      const heat = new Float32Array(w * h);
      const heatNext = new Float32Array(w * h);
      const windX = new Float32Array(w * h);
      const windY = new Float32Array(w * h);

      const cellCanvas = document.createElement('canvas');
      cellCanvas.width = w;
      cellCanvas.height = h;
      const cellCtx = cellCanvas.getContext('2d');
      const imageData = cellCtx.createImageData(w, h);

      simRef.current = {
        w, h, cells, life, moved, rest, heat, heatNext, windX, windY,
        cellCanvas, cellCtx, imageData, explosions: [],
        player: { x: 0, y: 0, vx: 0, vy: 0, w: 3, h: 4, alive: false, grounded: false, jumpQueued: false },
      };

      ensureGLResources(w, h);
    };

    setup();
    const resizeObserver = new ResizeObserver(() => setup());
    resizeObserver.observe(wrap);

    const idx = (x, y) => y * simRef.current.w + x;

    const swap = (x, y, nx, ny) => {
      const s = simRef.current;
      const i = idx(x, y);
      const j = idx(nx, ny);
      if (s.moved[i] || s.moved[j]) return false;
      const e = s.cells[i];
      const l = s.life[i];
      s.cells[i] = s.cells[j];
      s.life[i] = s.life[j];
      s.cells[j] = e;
      s.life[j] = l;
      s.moved[i] = 1;
      s.moved[j] = 1;
      return true;
    };

    const setAt = (x, y, e, l = 0) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.cells[i] = e;
      s.life[i] = l;
      s.moved[i] = 1;
    };

    const hasNeighbor = (x, y, el) => {
      const s = simRef.current;
      const { w, h, cells } = s;
      return (x > 0 && cells[idx(x - 1, y)] === el)
        || (x < w - 1 && cells[idx(x + 1, y)] === el)
        || (y > 0 && cells[idx(x, y - 1)] === el)
        || (y < h - 1 && cells[idx(x, y + 1)] === el);
    };

    const pickDir = () => (Math.random() < 0.5 ? 1 : -1);

    const spread = (x, y, maxD) => {
      const s = simRef.current;
      const d = pickDir();
      const empties = [];
      for (let k = 1; k <= maxD; k++) {
        const nx = x + d * k;
        if (nx < 0 || nx >= s.w) break;
        if (s.cells[idx(nx, y)] === E.EMPTY) empties.push(nx);
        else break;
      }
      if (empties.length) swap(x, y, empties[Math.floor(Math.random() * empties.length)], y);
    };

    const fallOrSink = (x, y, e) => {
      const s = simRef.current;
      const i = idx(x, y);
      if (s.rest[i] > 0) s.rest[i]--;
      const myD = DENSITY[e] ?? 1;
      const canEnter = (b) =>
        b === E.EMPTY || (s.rest[i] === 0 && isDisplaceable(b) && myD > (DENSITY[b] ?? 1));
      const settle = (j, b) => {
        if (b !== E.EMPTY) { s.rest[i] = REST_FRAMES; s.rest[j] = REST_FRAMES; }
      };
      // Grain jitter: falling powders occasionally tumble diagonally instead
      // of dropping straight down, so falling streams look lively.
      if (isPowder(e) && y < s.h - 1 && Math.random() < 0.35) {
        const d = pickDir();
        const nx = x + d;
        if (nx >= 0 && nx < s.w) {
          const j = idx(nx, y + 1);
          const b = s.cells[j];
          if (canEnter(b)) { settle(j, b); swap(x, y, nx, y + 1); return true; }
        }
      }
      if (y < s.h - 1) {
        const j = idx(x, y + 1);
        const b = s.cells[j];
        if (canEnter(b)) { settle(j, b); swap(x, y, x, y + 1); return true; }
      }
      const d = pickDir();
      for (const dd of [d, -d]) {
        const nx = x + dd;
        if (nx < 0 || nx >= s.w || y >= s.h - 1) continue;
        const j = idx(nx, y + 1);
        const b = s.cells[j];
        if (canEnter(b)) { settle(j, b); swap(x, y, nx, y + 1); return true; }
      }
      return false;
    };

    const stepGravity = (x, y, e) => {
      if (fallOrSink(x, y, e)) return;
      if (isLiquid(e)) spread(x, y, (e === E.WATER || e === E.OIL || e === E.NITRO) ? 3 : 2);
    };

    // Push a loose particle one cell in the dominant wind direction before its
    // normal gravity step runs — this is how lingering explosion gusts move things.
    const applyWind = (x, y, e) => {
      if (!isMobile(e)) return false;
      const s = simRef.current;
      const i = idx(x, y);
      const wx = s.windX[i];
      const wy = s.windY[i];
      if (Math.abs(wx) < 0.2 && Math.abs(wy) < 0.2) return false;
      const dirX = Math.abs(wx) > Math.abs(wy) ? Math.sign(wx) : 0;
      const dirY = Math.abs(wy) > Math.abs(wx) ? Math.sign(wy) : 0;
      const nx = x + dirX;
      const ny = y + dirY;
      if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) return false;
      const j = idx(nx, ny);
      const b = s.cells[j];
      const myD = DENSITY[e] ?? 1;
      if (b === E.EMPTY || (isDisplaceable(b) && myD > (DENSITY[b] ?? 1))) {
        swap(x, y, nx, ny);
        return true;
      }
      return false;
    };

    const igniteAround = (x, y) => {
      const s = simRef.current;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
          const j = idx(nx, ny);
          const e = s.cells[j];
          if (isExplosive(e)) {
            s.cells[j] = E.EMPTY;
            s.life[j] = 0;
            s.explosions.push({ x: nx, y: ny, radius: explosiveRadius(e) });
          } else if (e === E.OIL || e === E.WOOD || e === E.PLANT || e === E.VINE || e === E.SEED || e === E.GAS || e === E.ANT) {
            if (Math.random() < 0.5) {
              s.cells[j] = E.FIRE;
              s.life[j] = FIRE_LIFE * (0.6 + Math.random() * 0.6);
              s.moved[j] = 1;
            }
          } else if (e === E.ICE && Math.random() < 0.2) {
            s.cells[j] = E.WATER;
            s.life[j] = 0;
            s.moved[j] = 1;
          }
        }
      }
    };

    // ── Gravity elements (bottom-up) ──────────────────────────────────────
    const stepWater = (x, y) => {
      const s = simRef.current;
      if (y < s.h - 1) {
        const below = s.cells[idx(x, y + 1)];
        if (below === E.FIRE || below === E.TORCH) {
          s.cells[idx(x, y + 1)] = E.EMPTY;
          s.life[idx(x, y + 1)] = 0;
          s.moved[idx(x, y + 1)] = 0;
          swap(x, y, x, y + 1);
          return;
        }
        if (below === E.LAVA) { setAt(x, y, E.STONE); return; }
      }
      stepGravity(x, y, E.WATER);
    };

    const stepSalt = (x, y) => {
      const s = simRef.current;
      if (y < s.h - 1 && s.cells[idx(x, y + 1)] === E.WATER) { setAt(x, y, E.EMPTY); return; }
      stepGravity(x, y, E.SALT);
    };

    const stepSeed = (x, y) => {
      if (hasNeighbor(x, y, E.WATER)) { setAt(x, y, E.PLANT); return; }
      stepGravity(x, y, E.SEED);
    };

    const stepLava = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.life[i] -= 1;
      if (s.life[i] <= 0) { setAt(x, y, E.STONE); return; } // cools into stone
      igniteAround(x, y);
      stepGravity(x, y, E.LAVA);
    };

    const destructible = (el) =>
      el !== E.EMPTY && el !== E.WALL && el !== E.STONE && el !== E.METAL
      && el !== E.ACID && el !== E.LAVA;

    const stepAcid = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.life[i] -= 0.25;
      if (s.life[i] <= 0) { setAt(x, y, E.EMPTY); return; }

      const eat = (nx, ny) => {
        const j = idx(nx, ny);
        s.cells[j] = E.EMPTY;
        s.life[j] = 0;
        s.moved[j] = 0;
        s.life[i] -= 6;
      };

      if (y < s.h - 1) {
        const below = s.cells[idx(x, y + 1)];
        if (below === E.EMPTY) { swap(x, y, x, y + 1); return; }
        if (destructible(below)) { eat(x, y + 1); swap(x, y, x, y + 1); return; }
      }
      const d = pickDir();
      if (y < s.h - 1) {
        if (x + d >= 0 && x + d < s.w
          && (s.cells[idx(x + d, y + 1)] === E.EMPTY || destructible(s.cells[idx(x + d, y + 1)]))) {
          if (destructible(s.cells[idx(x + d, y + 1)])) eat(x + d, y + 1);
          swap(x, y, x + d, y + 1);
          return;
        }
        if (x - d >= 0 && x - d < s.w
          && (s.cells[idx(x - d, y + 1)] === E.EMPTY || destructible(s.cells[idx(x - d, y + 1)]))) {
          if (destructible(s.cells[idx(x - d, y + 1)])) eat(x - d, y + 1);
          swap(x, y, x - d, y + 1);
          return;
        }
      }
      const sx = x + pickDir();
      if (sx >= 0 && sx < s.w && destructible(s.cells[idx(sx, y)])) { eat(sx, y); return; }
      spread(x, y, 2);
    };

    // ── Rising / reactive elements (top-down) ─────────────────────────────
    const stepFire = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.life[i] -= 1;
      if (s.life[i] <= 0) { s.cells[i] = E.EMPTY; s.life[i] = 0; s.moved[i] = 0; return; }
      if (hasNeighbor(x, y, E.WATER)) { s.cells[i] = E.EMPTY; s.life[i] = 0; s.moved[i] = 0; return; }

      igniteAround(x, y);

      if (y > 0 && s.cells[idx(x, y - 1)] === E.EMPTY) { swap(x, y, x, y - 1); return; }
      const d = pickDir();
      if (y > 0 && x + d >= 0 && x + d < s.w && s.cells[idx(x + d, y - 1)] === E.EMPTY) { swap(x, y, x + d, y - 1); return; }
      if (y > 0 && x - d >= 0 && x - d < s.w && s.cells[idx(x - d, y - 1)] === E.EMPTY) { swap(x, y, x - d, y - 1); return; }
      const sx = x + pickDir();
      if (sx >= 0 && sx < s.w && s.cells[idx(sx, y)] === E.EMPTY) { swap(x, y, sx, y); return; }
    };

    const stepGas = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.life[i] -= 1;
      if (s.life[i] <= 0) { s.cells[i] = E.EMPTY; s.life[i] = 0; s.moved[i] = 0; return; }
      if (hasNeighbor(x, y, E.FIRE) || hasNeighbor(x, y, E.LAVA)) {
        s.cells[i] = E.FIRE;
        s.life[i] = FIRE_LIFE;
        s.moved[i] = 1;
        return;
      }
      if (y > 0 && s.cells[idx(x, y - 1)] === E.EMPTY) { swap(x, y, x, y - 1); return; }
      const d = pickDir();
      if (y > 0 && x + d >= 0 && x + d < s.w && s.cells[idx(x + d, y - 1)] === E.EMPTY) { swap(x, y, x + d, y - 1); return; }
      if (y > 0 && x - d >= 0 && x - d < s.w && s.cells[idx(x - d, y - 1)] === E.EMPTY) { swap(x, y, x - d, y - 1); return; }
      const sx = x + pickDir();
      if (sx >= 0 && sx < s.w && s.cells[idx(sx, y)] === E.EMPTY) { swap(x, y, sx, y); return; }
    };

    const stepSteam = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      s.life[i] -= 1;
      if (s.life[i] <= 0) { s.cells[i] = E.WATER; s.life[i] = 0; s.moved[i] = 0; return; }
      if (y > 0 && s.cells[idx(x, y - 1)] === E.EMPTY) { swap(x, y, x, y - 1); return; }
      const d = pickDir();
      if (y > 0 && x + d >= 0 && x + d < s.w && s.cells[idx(x + d, y - 1)] === E.EMPTY) { swap(x, y, x + d, y - 1); return; }
      if (y > 0 && x - d >= 0 && x - d < s.w && s.cells[idx(x - d, y - 1)] === E.EMPTY) { swap(x, y, x - d, y - 1); return; }
      const sx = x + pickDir();
      if (sx >= 0 && sx < s.w && s.cells[idx(sx, y)] === E.EMPTY) { swap(x, y, sx, y); return; }
    };

    const stepTorch = (x, y) => { igniteAround(x, y); };

    const stepPlant = (x, y) => {
      const s = simRef.current;
      if (y > 0 && s.cells[idx(x, y - 1)] === E.WATER) { swap(x, y, x, y - 1); }
    };

    const stepVine = (x, y) => {
      const s = simRef.current;
      if (y > 0 && s.cells[idx(x, y - 1)] === E.EMPTY) { swap(x, y, x, y - 1); return; }
      const d = pickDir();
      const sx = x + d;
      if (sx >= 0 && sx < s.w && s.cells[idx(sx, y)] === E.EMPTY) { swap(x, y, sx, y); return; }
      const sx2 = x - d;
      if (sx2 >= 0 && sx2 < s.w && s.cells[idx(sx2, y)] === E.EMPTY) { swap(x, y, sx2, y); }
    };

    const stepVirus = (x, y) => {
      const s = simRef.current;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let k = 0; k < 4; k++) {
        const [dx, dy] = dirs[(Math.random() * 4) | 0];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
        const j = idx(nx, ny);
        const e = s.cells[j];
        if (e !== E.EMPTY && e !== E.WALL && e !== E.METAL && e !== E.VIRUS) {
          s.cells[j] = E.VIRUS;
          s.life[j] = 0;
          s.moved[j] = 1;
          break;
        }
      }
    };

    const stepAnt = (x, y) => {
      const s = simRef.current;
      const i = idx(x, y);
      const dir = s.life[i] >= 0 ? 1 : -1;
      if (y < s.h - 1 && s.cells[idx(x, y + 1)] === E.EMPTY) { swap(x, y, x, y + 1); return; }
      const nx = x + dir;
      if (nx >= 0 && nx < s.w && s.cells[idx(nx, y)] === E.EMPTY) { swap(x, y, nx, y); return; }
      s.life[i] = -dir;
    };

    // ── Explosions + air pressure ─────────────────────────────────────────
    const shove = (cx, cy, radius, force) => {
      const s = simRef.current;
      for (let r = radius + force; r > radius; r--) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r || dx * dx + dy * dy < (r - 1) * (r - 1)) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || x >= s.w || y < 0 || y >= s.h) continue;
            const i = idx(x, y);
            const e = s.cells[i];
            if (e === E.EMPTY || !isMobile(e)) continue;
            const sx = Math.sign(dx) || 0;
            const sy = Math.sign(dy) || 0;
            if (sx === 0 && sy === 0) continue;
            let tx = x;
            let ty = y;
            for (let k = 0; k < force; k++) {
              const nx = tx + sx;
              const ny = ty + sy;
              if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) break;
              if (s.cells[idx(nx, ny)] !== E.EMPTY) break;
              tx = nx;
              ty = ny;
            }
            if (tx !== x || ty !== y) {
              s.cells[idx(tx, ty)] = e;
              s.life[idx(tx, ty)] = s.life[i];
              s.cells[i] = E.EMPTY;
              s.life[i] = 0;
            }
          }
        }
      }
    };

    // Radial gust that lingers after a blast and keeps pushing loose material.
    const gust = (cx, cy, radius) => {
      const s = simRef.current;
      const R = Math.max(3, Math.round(radius * 1.7));
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= s.w || y < 0 || y >= s.h) continue;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.5) continue;
          const f = 1 - dist / R;
          const i = idx(x, y);
          s.windX[i] = Math.max(-4, Math.min(4, s.windX[i] + (dx / dist) * f * 1.6));
          s.windY[i] = Math.max(-4, Math.min(4, s.windY[i] + (dy / dist) * f * 1.6));
        }
      }
    };

    const blast = (cx, cy, radius) => {
      const s = simRef.current;
      const r2 = radius * radius;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
          const j = idx(nx, ny);
          const e = s.cells[j];
          if (e === E.WALL || e === E.METAL) continue;
          if (isExplosive(e)) s.explosions.push({ x: nx, y: ny, radius: explosiveRadius(e) });
          s.cells[j] = E.EMPTY;
          s.life[j] = 0;
        }
      }
      const p = s.player;
      if (p && p.alive) {
        const pcx = p.x + p.w / 2;
        const pcy = p.y + p.h / 2;
        const ddx = pcx - cx;
        const ddy = pcy - cy;
        if (ddx * ddx + ddy * ddy < (radius + 2) * (radius + 2)) p.alive = false;
      }
      for (let a = 0; a < 40; a++) {
        const ang = (a / 40) * Math.PI * 2;
        const nx = Math.round(cx + Math.cos(ang) * radius);
        const ny = Math.round(cy + Math.sin(ang) * radius);
        if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
        const j = idx(nx, ny);
        if (s.cells[j] === E.EMPTY && Math.random() < 0.65) {
          s.cells[j] = E.FIRE;
          s.life[j] = FIRE_LIFE * (0.4 + Math.random() * 0.6);
        }
      }
      for (let k = 0; k < 6; k++) {
        const nx = cx + ((Math.random() * radius) | 0) * (Math.random() < 0.5 ? -1 : 1);
        const ny = cy + ((Math.random() * radius) | 0) * (Math.random() < 0.5 ? -1 : 1);
        if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
        const j = idx(nx, ny);
        if (s.cells[j] === E.EMPTY) {
          s.cells[j] = E.GAS;
          s.life[j] = GAS_LIFE * (0.4 + Math.random() * 0.4);
        }
      }
      shove(cx, cy, radius, Math.max(2, Math.round(radius * 0.6)));
      gust(cx, cy, radius);
    };

    const processExplosions = () => {
      const s = simRef.current;
      const q = s.explosions;
      let guard = 0;
      while (q.length && guard < 128) {
        guard++;
        const ex = q.pop();
        blast(ex.x, ex.y, ex.radius);
      }
    };

    // ── Heat transfer + phase changes ─────────────────────────────────────
    const updateHeat = () => {
      const s = simRef.current;
      const { w, h, cells, heat, heatNext } = s;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const src = HEAT_SOURCE[cells[i]];
          if (src !== undefined) { heatNext[i] = src; continue; }
          let m = 0;
          if (x > 0) m = Math.max(m, heat[i - 1]);
          if (x < w - 1) m = Math.max(m, heat[i + 1]);
          if (y > 0) m = Math.max(m, heat[i - w]);
          if (y < h - 1) m = Math.max(m, heat[i + w]);
          heatNext[i] = Math.max(heat[i] * 0.96, m * 0.8);
        }
      }
      s.heat = heatNext;
      s.heatNext = heat;
    };

    const applyPhaseChanges = () => {
      const s = simRef.current;
      const { w, h, cells, life, heat } = s;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const e = cells[i];
          const hh = heat[i];
          if (e === E.WATER && hh > 0.68) { cells[i] = E.STEAM; life[i] = STEAM_LIFE; }
          else if (e === E.ICE && hh > 0.40) { cells[i] = E.WATER; life[i] = 0; }
          else if (e === E.WOOD && hh > 0.60) { cells[i] = E.FIRE; life[i] = FIRE_LIFE; }
          else if (e === E.OIL && hh > 0.55) { cells[i] = E.FIRE; life[i] = FIRE_LIFE; }
          else if (isExplosive(e) && hh > 0.50) {
            cells[i] = E.EMPTY;
            life[i] = 0;
            s.explosions.push({ x, y, radius: explosiveRadius(e) });
          }
        }
      }
    };

    // ── Player ────────────────────────────────────────────────────────────
    const isSolid = (e) =>
      e === E.WALL || e === E.STONE || e === E.METAL || e === E.WOOD || e === E.PLANT
      || e === E.ICE || e === E.C4 || e === E.GLASS
      || e === E.SAND || e === E.SALT || e === E.GUNPOWDER || e === E.SEED;

    const isHazard = (e) => e === E.FIRE || e === E.LAVA || e === E.ACID || e === E.TORCH;

    const keys = new Set();

    const playerHits = (p, bx, by, kind) => {
      const s = simRef.current;
      const x0 = Math.floor(bx);
      const x1 = Math.floor(bx + p.w - 1);
      const y0 = Math.floor(by);
      const y1 = Math.floor(by + p.h - 1);
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (gx < 0 || gx >= s.w || gy < 0 || gy >= s.h) {
            if (kind === 'solid') return true;
            continue;
          }
          const e = s.cells[idx(gx, gy)];
          if (kind === 'solid' && isSolid(e)) return true;
          if (kind === 'hazard' && isHazard(e)) return true;
        }
      }
      return false;
    };

    const spawnPlayer = (gx, gy) => {
      const s = simRef.current;
      const p = s.player;
      p.x = gx - p.w / 2;
      p.y = gy - p.h / 2;
      p.vx = 0; p.vy = 0; p.grounded = false; p.alive = true; p.jumpQueued = false;
    };

    const stepPlayer = () => {
      const s = simRef.current;
      const p = s.player;
      if (!p.alive) return;

      if (playerHits(p, p.x, p.y, 'hazard')) { p.alive = false; return; }

      const left = keys.has('arrowleft') || keys.has('a');
      const right = keys.has('arrowright') || keys.has('d');
      const down = keys.has('arrowdown') || keys.has('s');

      p.vx = ((right ? 1 : 0) - (left ? 1 : 0)) * 0.22;
      p.vy += 0.18;
      if (down) p.vy += 0.22;
      if (p.vy > 1.4) p.vy = 1.4;

      if (p.jumpQueued && p.grounded) { p.vy = -1.6; p.grounded = false; }
      p.jumpQueued = false;

      const npx = p.x + p.vx;
      if (!playerHits(p, npx, p.y, 'solid')) p.x = npx;

      const npy = p.y + p.vy;
      if (!playerHits(p, p.x, npy, 'solid')) {
        p.y = npy;
        if (p.vy > 0) p.grounded = false;
      } else {
        if (p.vy > 0) p.grounded = true;
        p.vy = 0;
      }
    };

    const step = () => {
      const s = simRef.current;
      const { w, h, cells, moved } = s;
      moved.fill(0);

      // Wind from explosions decays over time.
      const wx = s.windX;
      const wy = s.windY;
      for (let i = 0; i < wx.length; i++) { wx[i] *= 0.9; wy[i] *= 0.9; }

      for (let y = h - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        for (let k = 0; k < w; k++) {
          const x = ltr ? k : w - 1 - k;
          const i = idx(x, y);
          const e = cells[i];
          if (e === E.EMPTY || moved[i]) continue;
          if (applyWind(x, y, e)) continue;
          if (e === E.SAND) stepGravity(x, y, e);
          else if (e === E.WATER) stepWater(x, y);
          else if (e === E.OIL) stepGravity(x, y, e);
          else if (e === E.MERCURY) stepGravity(x, y, e);
          else if (e === E.SALT) stepSalt(x, y);
          else if (e === E.SEED) stepSeed(x, y);
          else if (e === E.GUNPOWDER) stepGravity(x, y, e);
          else if (e === E.NITRO) stepGravity(x, y, e);
          else if (e === E.LAVA) stepLava(x, y);
          else if (e === E.ACID) stepAcid(x, y);
        }
      }

      for (let y = 0; y < h; y++) {
        const ltr = (y & 1) === 0;
        for (let k = 0; k < w; k++) {
          const x = ltr ? k : w - 1 - k;
          const i = idx(x, y);
          const e = cells[i];
          if (e === E.EMPTY || moved[i]) continue;
          if (applyWind(x, y, e)) continue;
          if (e === E.FIRE) stepFire(x, y);
          else if (e === E.GAS) stepGas(x, y);
          else if (e === E.STEAM) stepSteam(x, y);
          else if (e === E.TORCH) stepTorch(x, y);
          else if (e === E.PLANT) stepPlant(x, y);
          else if (e === E.VINE) stepVine(x, y);
          else if (e === E.VIRUS) stepVirus(x, y);
          else if (e === E.ANT) stepAnt(x, y);
        }
      }

      processExplosions();
      updateHeat();
      applyPhaseChanges();
      processExplosions();
      stepPlayer();
    };

    // ── Rendering (2D fallback) ───────────────────────────────────────────
    const render2D = () => {
      const s = simRef.current;
      if (!s) return;
      const { w, h, cells, life } = s;
      const data = s.imageData.data;
      for (let i = 0; i < w * h; i++) {
        const e = cells[i];
        const o = i * 4;
        if (e === E.EMPTY) { data[o + 3] = 0; continue; }
        let r, g, b;
        if (e === E.FIRE || e === E.TORCH) {
          const fl = e === E.TORCH ? 90 : life[i] + (i & 3) * 4;
          [r, g, b] = fireColor(fl);
        } else {
          const c = COLORS[e] || [255, 0, 255];
          r = c[0]; g = c[1]; b = c[2];
        }
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
      s.cellCtx.putImageData(s.imageData, 0, 0);
      ctx2d.imageSmoothingEnabled = false;
      const g = ctx2d.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, '#0d0f1e');
      g.addColorStop(1, '#170a18');
      ctx2d.fillStyle = g;
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(s.cellCanvas, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
    };

    // ── Rendering (WebGL) ─────────────────────────────────────────────────
    const renderWebGL = () => {
      const s = simRef.current;
      if (!s || !glRes || !P) return;
      const { w, h, cells, heat } = s;
      const R = glRes;

      gl.bindVertexArray(vao);

      gl.bindTexture(gl.TEXTURE_2D, R.cellTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, cells);
      gl.bindTexture(gl.TEXTURE_2D, R.heatTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, heat);

      // Scene pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.sceneFBO);
      gl.viewport(0, 0, w, h);
      gl.useProgram(P.mainProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, R.cellTex);
      gl.uniform1i(P.main.uCells, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, R.heatTex);
      gl.uniform1i(P.main.uHeat, 1);
      gl.uniform2f(P.main.uTexel, 1 / w, 1 / h);
      gl.uniform2f(P.main.uGridSize, w, h);
      gl.uniform1f(P.main.uTime, performance.now() * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Glow pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.glowFBO);
      gl.viewport(0, 0, w, h);
      gl.useProgram(P.glowProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, R.cellTex);
      gl.uniform1i(P.glow.uCells, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, R.heatTex);
      gl.uniform1i(P.glow.uHeat, 1);
      gl.uniform2f(P.glow.uTexel, 1 / w, 1 / h);
      gl.uniform2f(P.glow.uGridSize, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Blur the glow (4 passes: H, V, H, V).
      const bw = R.bw;
      const bh = R.bh;
      const blurPass = (srcTex, dstFBO, texW, texH, dx, dy) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
        gl.viewport(0, 0, texW, texH);
        gl.useProgram(P.blurProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(P.blur.uTex, 0);
        gl.uniform2f(P.blur.uDir, dx / texW, dy / texH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      blurPass(R.glowTex, R.blurAFBO, bw, bh, 1, 0);
      blurPass(R.blurATex, R.blurBFBO, bw, bh, 0, 1);
      blurPass(R.blurBTex, R.blurAFBO, bw, bh, 1, 0);
      blurPass(R.blurATex, R.blurBFBO, bw, bh, 0, 1);

      // Composite to canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.04, 0.04, 0.10, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(P.compProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, R.sceneTex);
      gl.uniform1i(P.comp.uScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, R.blurBTex);
      gl.uniform1i(P.comp.uBloom, 1);
      gl.uniform1f(P.comp.uStrength, 1.15);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const renderPlayer = () => {
      const s = simRef.current;
      if (!s) return;
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      const p = s.player;
      if (p && p.alive) {
        const sc = overlay.width / s.w;
        const px = p.x * sc;
        const py = p.y * sc;
        const pw = p.w * sc;
        const ph = p.h * sc;
        overlayCtx.fillStyle = '#6ee7ff';
        overlayCtx.fillRect(px, py, pw, ph);
        overlayCtx.strokeStyle = '#0b3b4a';
        overlayCtx.lineWidth = Math.max(1, sc * 0.35);
        overlayCtx.strokeRect(px, py, pw, ph);
      }
    };

    let renderFn = gl ? renderWebGL : render2D;

    // ── Painting / pointer input ──────────────────────────────────────────
    const lifeFor = (el) => {
      if (el === E.FIRE) return FIRE_LIFE * (0.7 + Math.random() * 0.6);
      if (el === E.GAS) return GAS_LIFE * (0.7 + Math.random() * 0.6);
      if (el === E.STEAM) return STEAM_LIFE * (0.7 + Math.random() * 0.6);
      if (el === E.ACID) return ACID_LIFE;
      if (el === E.LAVA) return LAVA_LIFE;
      if (el === E.ANT) return Math.random() < 0.5 ? 1 : -1;
      return 0;
    };

    const paintAt = (gx, gy) => {
      const s = simRef.current;
      const el = toolRef.current;
      if (el === E.PLAYER) return;
      const r = brushRef.current;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      for (let dy = -r; dy <= r; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= s.h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const px = cx + dx;
          if (px < 0 || px >= s.w) continue;
          if (dx * dx + dy * dy > r * r + r) continue;
          const i = idx(px, py);
          if (el === E.ERASER) {
            s.cells[i] = E.EMPTY;
            s.life[i] = 0;
          } else {
            s.cells[i] = el;
            s.life[i] = lifeFor(el);
          }
        }
      }
    };

    const toGrid = (e) => {
      const s = simRef.current;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * s.w,
        y: ((e.clientY - rect.top) / rect.height) * s.h,
      };
    };

    const onDown = (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      const p = toGrid(e);
      pointerRef.current = { down: true, x: p.x, y: p.y };
      if (toolRef.current === E.PLAYER) spawnPlayer(p.x, p.y);
      else paintAt(p.x, p.y);
    };

    const onMove = (e) => {
      const p = pointerRef.current;
      if (!p.down) return;
      const g = toGrid(e);
      const dx = g.x - p.x;
      const dy = g.y - p.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = Math.max(1, brushRef.current * 0.5);
      const n = Math.max(1, Math.ceil(dist / stepLen));
      for (let i = 0; i <= n; i++) paintAt(p.x + dx * (i / n), p.y + dy * (i / n));
      p.x = g.x;
      p.y = g.y;
    };

    const onUp = (e) => {
      pointerRef.current.down = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const onKeyDown = (ev) => {
      const k = ev.key.toLowerCase();
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp'
        || ev.key === 'ArrowDown' || ev.key === ' ') {
        ev.preventDefault();
      }
      keys.add(k);
      if (k === ' ' || k === 'arrowup' || k === 'w') {
        const s = simRef.current;
        if (s && s.player) s.player.jumpQueued = true;
      }
    };
    const onKeyUp = (ev) => { keys.delete(ev.key.toLowerCase()); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ── Main loop ─────────────────────────────────────────────────────────
    let last = performance.now();
    let acc = 0;
    const STEP_MS = 1000 / 60;
    let warned = false;

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      let dt = now - last;
      last = now;
      if (dt > 100) dt = 100;
      if (!pausedRef.current) {
        acc += dt;
        let guard = 0;
        while (acc >= STEP_MS && guard < 4) {
          step();
          acc -= STEP_MS;
          guard++;
        }
        if (guard >= 4) acc = 0;
      }
      try {
        renderFn();
      } catch (err) {
        if (!warned) { warned = true; console.error('Fluid render error', err); }
      }
      renderPlayer();
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleClear = () => {
    const s = simRef.current;
    if (s) {
      s.cells.fill(E.EMPTY);
      s.life.fill(0);
      s.rest.fill(0);
      s.heat.fill(0);
      s.heatNext.fill(0);
      s.windX.fill(0);
      s.windY.fill(0);
      s.explosions.length = 0;
      const p = s.player;
      p.alive = false;
      p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.grounded = false;
    }
  };

  return (
    <>
      <SEO
        title="Fluid"
        description="A realistic falling-sand playground — pour materials, watch them settle by density, melt, boil and explode with heat and pressure."
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
            <p className="fluid-eyebrow">Interactive · Falling-sand toy</p>
            <h1 className="fluid-title">Fluid</h1>
            <div className="fluid-underline" aria-hidden="true" />
            <p className="fluid-subtitle">
              A falling-sand playground rendered like a real material — directional
              light on every grain, smooth liquid surfaces, and glowing heat. Fire boils
              water, melts ice, and slowly cooks wood to ignition.
            </p>
            <ul className="fluid-tags" aria-label="Highlights">
              <li>25+ elements</li>
              <li>Heat &amp; boiling</li>
              <li>Bloom &amp; shading</li>
              <li>Ants &amp; player</li>
            </ul>
          </div>

          <div className="fluid-card">
            <div className="fluid-card__bar">
              <span className="fluid-card__bar-title">Playground</span>
              <span className={`fluid-live${paused ? ' fluid-live--paused' : ''}`}>
                <span className="fluid-live__dot" aria-hidden="true" />
                {paused ? 'Paused' : 'Live'}
              </span>
            </div>

            <div className="fluid-elements" role="group" aria-label="Choose an element">
              {ELEMENTS.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  className={`fluid-element${tool === el.id ? ' active' : ''}`}
                  aria-pressed={tool === el.id}
                  onClick={() => setTool(el.id)}
                >
                  <span
                    className={`fluid-element__dot${el.id === E.ERASER ? ' fluid-element__dot--erase' : ''}`}
                    style={el.color ? { background: el.color } : undefined}
                  >
                    {el.id === E.ERASER ? '✕' : ''}
                  </span>
                  <span className="fluid-element__name">{el.name}</span>
                </button>
              ))}
            </div>

            <div className="fluid-toolbar">
              <div className="fluid-brushes" role="group" aria-label="Brush size">
                {BRUSHES.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    title={`Brush ${b.px}px`}
                    aria-label={`Brush size ${b.px} pixels`}
                    className={`fluid-brush${brush === b.value ? ' active' : ''}`}
                    onClick={() => setBrush(b.value)}
                  >
                    <span
                      className="fluid-brush__dot"
                      style={{ width: b.value * 3 + 4, height: b.value * 3 + 4 }}
                    />
                    <span className="fluid-brush__label">{b.label}</span>
                  </button>
                ))}
              </div>

              <div className="fluid-actions">
                <button
                  type="button"
                  className="fluid-btn"
                  onClick={() => setPaused((v) => !v)}
                >
                  {paused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button type="button" className="fluid-btn" onClick={handleClear}>
                  ✕ Clear
                </button>
              </div>
            </div>

            <div className="fluid-canvas-wrap" ref={wrapRef}>
              <canvas ref={canvasRef} className="fluid-canvas" aria-label="Falling-sand simulation" />
              <canvas ref={overlayRef} className="fluid-overlay" aria-hidden="true" />
            </div>

            <p className="fluid-hint">
              Click or drag to pour an element. Pick <strong>Player</strong> then click to drop
              yourself in — move with ← → / A D, jump with ↑ / W / Space, fast-drop with ↓ / S.
              Try lava into water, fire under ice, and gunpowder near a torch.
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Fluid;
