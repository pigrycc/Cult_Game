// ============================================================================
//  CHARACTER PHYSICS — deterministic kinematic controller used by BOTH the
//  host (authoritative simulation) and the client (prediction/reconciliation).
//  Colliders: thick wall segments, AABB boxes (standable), circles, gates.
//  "Ragdoll" = uncontrolled ballistic tumble state (server-driven knockback),
//  visualised on the client by the procedural ragdoll rig.
// ============================================================================
import { walls, boxes, GATES, PORTAL } from './map.js';

export const PLAYER_R = 0.38;
export const PLAYER_H = 1.15;
export const EYE_H = 0.85;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 6.6;
export const JUMP_V = 5.6;
export const GRAVITY = 18;

export const circles = [{ x: PORTAL.x, z: PORTAL.z, r: 2.25, h: 3 }];

export function makeBody(x = 0, z = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, ragdoll: 0, spin: 0 };
}

function pushOutSegment(b, s, r) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-6 ? ((b.x - s.x1) * dx + (b.z - s.z1) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + dx * t, cz = s.z1 + dz * t;
  let ox = b.x - cx, oz = b.z - cz;
  const d = Math.hypot(ox, oz);
  const min = r + s.t / 2;
  if (d < min) {
    if (d < 1e-5) { ox = -dz; oz = dx; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l; } else { ox /= d; oz /= d; }
    const pen = min - d;
    b.x += ox * pen; b.z += oz * pen;
    const vn = b.vx * ox + b.vz * oz;
    if (vn < 0) { b.vx -= vn * ox * (b.ragdoll > 0 ? 1.6 : 1); b.vz -= vn * oz * (b.ragdoll > 0 ? 1.6 : 1); }
    return true;
  }
  return false;
}

function pushOutBox(b, bx, r) {
  const hx = bx.w / 2, hz = bx.d / 2;
  const top = bx.h;
  if (b.y >= top - 0.06) return false; // standing above
  const cx = Math.max(bx.x - hx, Math.min(bx.x + hx, b.x));
  const cz = Math.max(bx.z - hz, Math.min(bx.z + hz, b.z));
  let ox = b.x - cx, oz = b.z - cz;
  const d = Math.hypot(ox, oz);
  if (d < r) {
    if (d < 1e-5) {
      // inside: push along smallest axis
      const px = hx - Math.abs(b.x - bx.x), pz = hz - Math.abs(b.z - bx.z);
      if (px < pz) b.x += Math.sign(b.x - bx.x || 1) * (px + r); else b.z += Math.sign(b.z - bx.z || 1) * (pz + r);
      return true;
    }
    ox /= d; oz /= d;
    b.x += ox * (r - d); b.z += oz * (r - d);
    const vn = b.vx * ox + b.vz * oz;
    if (vn < 0) { b.vx -= vn * ox; b.vz -= vn * oz; }
    return true;
  }
  return false;
}

function pushOutCircle(b, c, r) {
  if (b.y >= c.h) return;
  let ox = b.x - c.x, oz = b.z - c.z;
  const d = Math.hypot(ox, oz), min = r + c.r;
  if (d < min && d > 1e-5) { ox /= d; oz /= d; b.x += ox * (min - d); b.z += oz * (min - d); }
}

/** Ground height under (x,z) – tops of boxes the body is above. */
function groundAt(b, r) {
  let g = 0;
  for (const bx of boxes) {
    if (bx.h > 1.3) continue; // too tall to stand on
    if (Math.abs(b.x - bx.x) < bx.w / 2 + r * 0.3 && Math.abs(b.z - bx.z) < bx.d / 2 + r * 0.3 && b.y >= bx.h - 0.25) g = Math.max(g, bx.h);
  }
  return g;
}

/**
 * Integrate one input frame.
 * @param b    body
 * @param inp  {fwd, strafe, yaw, pitch, jump, sprint}
 * @param dt   seconds
 * @param ctx  {gateClosed(id)->bool, speedMul, drunk:number, time, extraCircles:[]}
 */
export function stepBody(b, inp, dt, ctx = {}) {
  b.yaw = inp.yaw; b.pitch = inp.pitch;
  if (ctx.locked) { b.vx = b.vz = 0; return; }
  const ragdoll = b.ragdoll > 0;
  if (ragdoll) {
    b.ragdoll = Math.max(0, b.ragdoll - dt);
    const f = b.onGround ? Math.exp(-3.2 * dt) : 1;
    b.vx *= f; b.vz *= f;
  } else if (!ctx.frozen) {
    let fwd = inp.fwd || 0, str = inp.strafe || 0;
    const len = Math.hypot(fwd, str); if (len > 1) { fwd /= len; str /= len; }
    let yaw = b.yaw;
    if (ctx.drunk) { yaw += Math.sin((ctx.time || 0) * 2.3) * 0.7 * ctx.drunk; }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const sp = (inp.sprint ? SPRINT_SPEED : WALK_SPEED) * (ctx.speedMul ?? 1);
    const tx = (fx * fwd + rx * str) * sp, tz = (fz * fwd + rz * str) * sp;
    const acc = b.onGround ? 38 : 9;
    const k = Math.min(1, acc * dt / Math.max(0.001, sp));
    b.vx += (tx - b.vx) * k * (b.onGround ? 1 : 0.6);
    b.vz += (tz - b.vz) * k * (b.onGround ? 1 : 0.6);
    if (inp.jump && b.onGround && !ctx.noJump) { b.vy = JUMP_V; b.onGround = false; }
  } else { b.vx *= 0.5; b.vz *= 0.5; }

  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
  if (ragdoll) b.spin += Math.hypot(b.vx, b.vz) * dt * 2.2;

  const r = PLAYER_R;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of walls) if (b.y < s.h) pushOutSegment(b, s, r);
    for (const id in GATES) if (ctx.gateClosed && ctx.gateClosed(id)) pushOutSegment(b, GATES[id], r);
    for (const bx of boxes) pushOutBox(b, bx, r);
    for (const c of circles) pushOutCircle(b, c, r);
    if (ctx.extraCircles) for (const c of ctx.extraCircles) pushOutCircle(b, c, r);
  }
  const g = groundAt(b, r);
  if (b.y <= g) { b.y = g; if (b.vy < 0) b.vy = 0; b.onGround = true; } else b.onGround = b.y - g < 0.02;
}

/** Number of wall segments crossing the line A→B (for LOS & voice occlusion). */
export function wallsBetween(ax, az, bx, bz, maxCount = 4) {
  let n = 0;
  for (const s of walls) {
    if (segIntersect(ax, az, bx, bz, s.x1, s.z1, s.x2, s.z2)) { n++; if (n >= maxCount) break; }
  }
  return n;
}
function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = cross(dx - cx, dz - cz, ax - cx, az - cz), d2 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  const d3 = cross(bx - ax, bz - az, cx - ax, cz - az), d4 = cross(bx - ax, bz - az, dx - ax, dz - az);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function cross(ax, az, bx, bz) { return ax * bz - az * bx; }

export function forwardVec(yaw, pitch = 0) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Is point P roughly in front of the body (aim check used by server validation). */
export function inFront(b, px, pz, minDot = 0.25) {
  const dx = px - b.x, dz = pz - b.z, d = Math.hypot(dx, dz) || 1;
  const f = forwardVec(b.yaw);
  return (dx * f.x + dz * f.z) / d >= minDot;
}
