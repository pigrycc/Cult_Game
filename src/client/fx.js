// Lightweight particle bursts (steam, toxic smoke, portal bursts, task sparkles, shockwaves)
import * as THREE from 'three';

function makeDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene) { this.scene = scene; this.systems = []; this.rings = []; this.tex = makeDotTexture(); }

  burst({ x, y = 0.5, z, n = 40, color = '#ffffff', speed = 3, up = 2, life = 1.2, size = 0.4, gravity = -1, spread = 1, additive = false, opacity = 0.8 }) {
    const pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 0.3 * spread; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3 * spread;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      vel.push([Math.cos(a) * s * spread, up * (0.5 + Math.random()), Math.sin(a) * s * spread]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size, map: this.tex, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(geo, m);
    this.scene.add(pts);
    this.systems.push({ pts, vel, life, t: 0, gravity, opacity });
  }

  ring(x, z, color = '#ffffff', maxR = 6, life = 0.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.3, z);
    this.scene.add(m); this.rings.push({ m, t: 0, life, maxR });
  }

  play(type, d, world) {
    switch (type) {
      case 'steam_warn': this.burst({ x: d.x, z: d.z, y: 0.1, n: 10, color: '#dddddd', speed: 0.4, up: 0.6, life: 1, size: 0.25 }); break;
      case 'steam': this.burst({ x: d.x, z: d.z, y: 0.2, n: 80, color: '#f4f4f4', speed: 1.2, up: 7, life: 1.6, size: 0.9, gravity: -2, opacity: 0.7 }); break;
      case 'taskdone': this.burst({ x: d.x, y: d.y || 1, z: d.z, n: 50, color: '#ffe066', speed: 2.5, up: 3, life: 1.0, size: 0.18, gravity: -6, additive: true }); break;
      case 'taskstep': this.burst({ x: d.x, y: d.y || 1, z: d.z, n: 14, color: '#fff2a0', speed: 1.4, up: 1.5, life: 0.6, size: 0.12, gravity: -4, additive: true }); break;
      case 'shockwave': this.ring(d.x, d.z, '#ffffff', 7, 0.6); this.burst({ x: d.x, z: d.z, y: 1, n: 60, color: '#e8d8b0', speed: 6, up: 1, life: 0.8, size: 0.3 }); break;
      case 'portal_burst': {
        const col = { fire: '#ff8a1c', blood: '#ff2a4a', chaos: '#b06bff' }[d.faction] || '#b06bff';
        this.burst({ x: 0, z: 0, y: 1.2, n: 220, color: col, speed: 6, up: 6, life: 1.8, size: 0.35, gravity: -3, additive: true });
        this.ring(0, 0, col, 10, 0.9);
        if (world?.portal) world.portal.userData.burst = 1;
        break;
      }
      case 'fumes': this.burst({ x: 0, z: 3.5, y: 1.2, n: 160, color: '#6aff6a', speed: 2.5, up: 2, life: 3.5, size: 1.2, gravity: 0.2, opacity: 0.55 }); this.burst({ x: 0, z: 3.5, y: 1.2, n: 80, color: '#b26bff', speed: 2, up: 2, life: 3, size: 1.1, gravity: 0.2, opacity: 0.5 }); break;
      case 'slap': this.burst({ x: d.x, z: d.z, y: 1.1, n: 18, color: d.whip ? '#ff6060' : '#ffffff', speed: 3, up: 1, life: 0.4, size: 0.15, gravity: -5, additive: true }); break;
      case 'puff': this.burst({ x: d.x, z: d.z, y: 0.3, n: 20, color: '#d8d0c0', speed: 2, up: 1, life: 0.6, size: 0.4 }); break;
      case 'thud': case 'scoop': this.burst({ x: d.x, z: d.z, y: 0.3, n: 16, color: '#b8955a', speed: 1.5, up: 1.2, life: 0.5, size: 0.2, gravity: -6 }); break;
      case 'fizzle': this.burst({ x: d.x, z: d.z, y: 1.3, n: 40, color: '#66ff99', speed: 1, up: 2, life: 1.2, size: 0.3, additive: true }); break;
      case 'explosion': for (let i = 0; i < 5; i++) this.burst({ x: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20, y: 1, n: 120, color: i % 2 ? '#ff5a1a' : '#ffcf40', speed: 10, up: 8, life: 2.2, size: 0.8, gravity: -4, additive: true }); break;
      case 'rebellion': this.burst({ x: 0, z: 0, y: 3, n: 160, color: '#ff4040', speed: 5, up: 4, life: 1.5, size: 0.25, gravity: -5, additive: true }); break;
      case 'chime': break;
      case 'bell': this.ring(d.x, d.z, d.ok ? '#ffe066' : '#ff4444', 1.5, 0.4); break;
      case 'lift': case 'trapdoor': break;
      default: break;
    }
  }

  update(dt) {
    for (let i = this.systems.length - 1; i >= 0; i--) {
      const s = this.systems[i]; s.t += dt;
      const a = s.pts.geometry.attributes.position.array;
      s.vel.forEach((v, j) => { v[1] += s.gravity * dt; a[j * 3] += v[0] * dt; a[j * 3 + 1] = Math.max(0.02, a[j * 3 + 1] + v[1] * dt); a[j * 3 + 2] += v[2] * dt; v[0] *= 0.98; v[2] *= 0.98; });
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = s.opacity * Math.max(0, 1 - s.t / s.life);
      if (s.t >= s.life) { this.scene.remove(s.pts); s.pts.geometry.dispose(); s.pts.material.dispose(); this.systems.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const k = r.t / r.life;
      r.m.scale.setScalar(0.3 + k * r.maxR); r.m.material.opacity = 0.8 * (1 - k);
      if (k >= 1) { this.scene.remove(r.m); this.rings.splice(i, 1); }
    }
  }
}
