export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
export function weighted(entries) { // [[value, weight]]
  const tot = entries.reduce((s, e) => s + e[1], 0);
  let r = Math.random() * tot;
  for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
}
// Garble text for Toxic Fumes intoxication
export function garble(text) {
  const hic = ['*hic*', '*burp*', 'blurgh', 'mmmf'];
  return text.split(' ').map(w => {
    if (Math.random() < 0.18) return pick(hic);
    return w.split('').map(c => (/[a-z]/i.test(c) && Math.random() < 0.35) ? pick('aeiouwhmrl'.split('')) : c).join('');
  }).join(' ');
}
