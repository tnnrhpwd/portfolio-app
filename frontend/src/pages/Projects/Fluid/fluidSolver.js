// fluidSolver.js
// A compact, GPU-free "stable fluids" solver (after Jos Stam's method, as
// popularized by Mike Ash). It simulates an incompressible velocity field
// plus a passively-advected RGB dye field on a uniform grid, driven entirely
// by pointer input from the UI.
//
// All fields are stored in flat Float32Arrays. Scalar fields (velocity,
// pressure, divergence, curl) use a stride of 1, while the dye field uses a
// stride of 3 (R, G, B). The stride-aware helpers let us reuse one set of
// boundary / solver / advection routines for both cases.

export class FluidSolver {
  constructor(width, height, options = {}) {
    this.w = Math.max(8, Math.floor(width));
    this.h = Math.max(8, Math.floor(height));
    this.iter = options.iter || 8; // Gauss–Seidel iterations per linear solve
    this.viscosity = options.viscosity ?? 0.0001;
    this.diffusion = options.diffusion ?? 0.00002;
    this.dissipation = options.dissipation ?? 0.985; // dye fade per step
    this.vorticityStrength = options.vorticity ?? 0.6;
    this.velocityDamping = options.velocityDamping ?? 0.998;
    this.dt = options.dt ?? 0.04;

    const n = this.w * this.h;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.dye = new Float32Array(n * 3);
    this.dye0 = new Float32Array(n * 3);
    this.p = new Float32Array(n);
    this.div = new Float32Array(n);
    this.curl = new Float32Array(n);
  }

  idx(x, y) {
    return x + y * this.w;
  }

  // x[i] += dt * s[i]
  addSource(x, s, dt) {
    for (let i = 0; i < x.length; i++) x[i] += dt * s[i];
  }

  // Apply reflecting (b === 1: left/right walls, b === 2: top/bottom walls)
  // or copying (any other b) boundary conditions. `stride` is 1 for scalar
  // fields and 3 for the RGB dye field.
  setBnd(b, x, stride = 1) {
    const { w, h } = this;

    // left / right columns
    for (let y = 0; y < h; y++) {
      const l = this.idx(0, y) * stride;
      const r = this.idx(w - 1, y) * stride;
      const lIn = this.idx(1, y) * stride;
      const rIn = this.idx(w - 2, y) * stride;
      for (let c = 0; c < stride; c++) {
        if (b === 1) {
          x[l + c] = -x[lIn + c];
          x[r + c] = -x[rIn + c];
        } else {
          x[l + c] = x[lIn + c];
          x[r + c] = x[rIn + c];
        }
      }
    }

    // top / bottom rows
    for (let xc = 0; xc < w; xc++) {
      const t = this.idx(xc, 0) * stride;
      const btm = this.idx(xc, h - 1) * stride;
      const tIn = this.idx(xc, 1) * stride;
      const btmIn = this.idx(xc, h - 2) * stride;
      for (let c = 0; c < stride; c++) {
        if (b === 2) {
          x[t + c] = -x[tIn + c];
          x[btm + c] = -x[btmIn + c];
        } else {
          x[t + c] = x[tIn + c];
          x[btm + c] = x[btmIn + c];
        }
      }
    }

    // corners: average of the two adjacent edges
    const c00 = this.idx(0, 0) * stride;
    const c10 = this.idx(1, 0) * stride;
    const c01 = this.idx(0, 1) * stride;
    const cw0 = this.idx(w - 1, 0) * stride;
    const cw1 = this.idx(w - 2, 0) * stride;
    const cw2 = this.idx(w - 1, 1) * stride;
    const c0h = this.idx(0, h - 1) * stride;
    const c1h = this.idx(1, h - 1) * stride;
    const c0h1 = this.idx(0, h - 2) * stride;
    const cwh = this.idx(w - 1, h - 1) * stride;
    const cw1h = this.idx(w - 2, h - 1) * stride;
    const cwh1 = this.idx(w - 1, h - 2) * stride;
    for (let c = 0; c < stride; c++) {
      x[c00 + c] = 0.5 * (x[c10 + c] + x[c01 + c]);
      x[cw0 + c] = 0.5 * (x[cw1 + c] + x[cw2 + c]);
      x[c0h + c] = 0.5 * (x[c1h + c] + x[c0h1 + c]);
      x[cwh + c] = 0.5 * (x[cw1h + c] + x[cwh1 + c]);
    }
  }

  // Gauss–Seidel relaxation: solve x = (x0 + a * Laplacian(x)) / scale.
  linSolve(b, x, x0, a, scale, stride = 1) {
    const { w, h, iter } = this;
    const row = w * stride;
    for (let k = 0; k < iter; k++) {
      for (let y = 1; y < h - 1; y++) {
        const base = y * w * stride;
        for (let xc = 1; xc < w - 1; xc++) {
          const i = base + xc * stride;
          const il = i - stride;
          const ir = i + stride;
          const iu = i - row;
          const id = i + row;
          for (let c = 0; c < stride; c++) {
            x[i + c] = (x0[i + c] + a * (x[il + c] + x[ir + c] + x[iu + c] + x[id + c])) / scale;
          }
        }
      }
      this.setBnd(b, x, stride);
    }
  }

  // Diffusion via an implicit solve (unconditionally stable).
  diffuse(b, x, x0, diff, dt, stride = 1) {
    const a = dt * diff * this.w * this.h;
    this.linSolve(b, x, x0, a, 1 + 4 * a, stride);
  }

  // Semi-Lagrangian advection. Reads from d0, backtracks along the velocity
  // field (u, v), and bilinearly interpolates into d.
  advect(b, d, d0, u, v, dt, stride = 1) {
    const { w, h } = this;
    const dt0x = dt * w;
    const dt0y = dt * h;
    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let xc = 1; xc < w - 1; xc++) {
        const i = base + xc;
        let sx = xc - dt0x * u[i];
        let sy = y - dt0y * v[i];
        if (sx < 0.5) sx = 0.5;
        else if (sx > w - 1.5) sx = w - 1.5;
        if (sy < 0.5) sy = 0.5;
        else if (sy > h - 1.5) sy = h - 1.5;
        const i0 = sx | 0;
        const j0 = sy | 0;
        const i1 = i0 + 1;
        const j1 = j0 + 1;
        const s1 = sx - i0;
        const s0 = 1 - s1;
        const t1 = sy - j0;
        const t0 = 1 - t1;

        const di = i * stride;
        const a00 = (i0 + j0 * w) * stride;
        const a01 = (i0 + j1 * w) * stride;
        const a10 = (i1 + j0 * w) * stride;
        const a11 = (i1 + j1 * w) * stride;
        const w00 = s0 * t0;
        const w01 = s0 * t1;
        const w10 = s1 * t0;
        const w11 = s1 * t1;
        for (let c = 0; c < stride; c++) {
          d[di + c] = w00 * d0[a00 + c] + w01 * d0[a01 + c] + w10 * d0[a10 + c] + w11 * d0[a11 + c];
        }
      }
    }
    this.setBnd(b, d, stride);
  }

  // Pressure projection: make the velocity field divergence-free.
  project(u, v, p, div) {
    const { w, h } = this;
    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let xc = 1; xc < w - 1; xc++) {
        const i = base + xc;
        div[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + w] - v[i - w]);
        p[i] = 0;
      }
    }
    this.setBnd(0, div);
    this.setBnd(0, p);
    this.linSolve(0, p, div, 1, 4);

    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let xc = 1; xc < w - 1; xc++) {
        const i = base + xc;
        u[i] -= 0.5 * (p[i + 1] - p[i - 1]);
        v[i] -= 0.5 * (p[i + w] - p[i - w]);
      }
    }
    this.setBnd(1, u);
    this.setBnd(2, v);
  }

  // Vorticity confinement — injects energy back into small-scale swirls so
  // they don't smear out under numerical dissipation.
  vorticityConfinement(u, v, dt) {
    const { w, h, curl } = this;
    const eps = this.vorticityStrength;

    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let xc = 1; xc < w - 1; xc++) {
        const i = base + xc;
        curl[i] = 0.5 * (v[i + 1] - v[i - 1]) - 0.5 * (u[i + w] - u[i - w]);
      }
    }

    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let xc = 1; xc < w - 1; xc++) {
        const i = base + xc;
        const wx = 0.5 * (Math.abs(curl[i + 1]) - Math.abs(curl[i - 1]));
        const wy = 0.5 * (Math.abs(curl[i + w]) - Math.abs(curl[i - w]));
        const len = Math.sqrt(wx * wx + wy * wy) + 1e-4;
        const force = (eps * curl[i]) / len;
        u[i] += dt * force * wy;
        v[i] -= dt * force * wx;
      }
    }
  }

  // Advance the simulation one time step.
  //
  // Field/source bookkeeping follows Stam's vel_step/dens_step exactly: a
  // field is swapped with its "previous" buffer, transformed, and swapped
  // again before the next stage reads it back. Swapping is done per-field
  // (u and v are independent), since swapping them together would corrupt
  // whichever one was already processed.
  step(dt = this.dt) {
    const p = this.p;
    const div = this.div;

    // ── Velocity: sources → viscosity → project → vorticity → advect → project
    this.addSource(this.u, this.u0, dt);
    this.addSource(this.v, this.v0, dt);

    // Diffuse u
    let t = this.u;
    this.u = this.u0;
    this.u0 = t;
    this.diffuse(1, this.u, this.u0, this.viscosity, dt);

    // Diffuse v
    t = this.v;
    this.v = this.v0;
    this.v0 = t;
    this.diffuse(2, this.v, this.v0, this.viscosity, dt);

    this.project(this.u, this.v, p, div);
    this.vorticityConfinement(this.u, this.v, dt);

    // Advect velocity through itself
    t = this.u;
    this.u = this.u0;
    this.u0 = t;
    t = this.v;
    this.v = this.v0;
    this.v0 = t;
    this.advect(1, this.u, this.u0, this.u0, this.v0, dt);
    this.advect(2, this.v, this.v0, this.u0, this.v0, dt);
    this.project(this.u, this.v, p, div);

    // Gentle global damping keeps speeds from growing without bound.
    for (let i = 0; i < this.u.length; i++) {
      this.u[i] *= this.velocityDamping;
      this.v[i] *= this.velocityDamping;
    }

    // ── Dye: sources → diffusion → advection → fade
    this.addSource(this.dye, this.dye0, dt);
    t = this.dye;
    this.dye = this.dye0;
    this.dye0 = t;
    this.diffuse(0, this.dye, this.dye0, this.diffusion, dt, 3);
    t = this.dye;
    this.dye = this.dye0;
    this.dye0 = t;
    this.advect(0, this.dye, this.dye0, this.u, this.v, dt, 3);

    for (let i = 0; i < this.dye.length; i++) this.dye[i] *= this.dissipation;

    // Reset source buffers for the next frame.
    this.u0.fill(0);
    this.v0.fill(0);
    this.dye0.fill(0);
  }

  // Deposit dye at (x, y) in cell coordinates. `amount` is the final density
  // added (independent of dt) and falls off as a Gaussian over `radius` cells.
  splat(x, y, r, g, b, radius, amount) {
    const { w, h } = this;
    const ri = Math.max(1, Math.floor(radius));
    const invDt = 1 / this.dt;
    const cx0 = Math.round(x);
    const cy0 = Math.round(y);
    for (let dy = -ri; dy <= ri; dy++) {
      const cy = cy0 + dy;
      if (cy < 0 || cy >= h) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const cx = cx0 + dx;
        if (cx < 0 || cx >= w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const falloff = Math.exp(-d2 / (radius * radius));
        const i = (cx + cy * w) * 3;
        const add = amount * falloff * invDt;
        this.dye0[i] += r * add;
        this.dye0[i + 1] += g * add;
        this.dye0[i + 2] += b * add;
      }
    }
  }

  // Add velocity at (x, y) in cell coordinates. fx/fy are the desired
  // velocity increment in cells per step (independent of dt).
  addForce(x, y, fx, fy, radius) {
    const { w, h } = this;
    const ri = Math.max(1, Math.floor(radius));
    const invDt = 1 / this.dt;
    const cx0 = Math.round(x);
    const cy0 = Math.round(y);
    for (let dy = -ri; dy <= ri; dy++) {
      const cy = cy0 + dy;
      if (cy < 0 || cy >= h) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const cx = cx0 + dx;
        if (cx < 0 || cx >= w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const falloff = Math.exp(-d2 / (radius * radius));
        const i = cx + cy * w;
        const add = falloff * invDt;
        this.u0[i] += fx * add;
        this.v0[i] += fy * add;
      }
    }
  }
}
