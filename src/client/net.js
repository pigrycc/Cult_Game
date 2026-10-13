// Thin WebSocket client. JSON for game messages, binary for voice frames.
export class Net {
  constructor() { this.ws = null; this.handlers = new Map(); this.onVoice = null; this.onClose = null; this.rtt = 0; }

  connect(url, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Could not reach ' + url)); } };
      ws.onclose = () => { if (!settled) { settled = true; reject(new Error('Connection closed')); } else this.onClose && this.onClose(); };
      ws.onmessage = ev => {
        if (typeof ev.data !== 'string') { this.onVoice && this.onVoice(ev.data); return; }
        const msg = JSON.parse(ev.data);
        if (!settled && msg.t === 'welcome') { settled = true; resolve(msg); }
        if (!settled && msg.t === 'reject') { settled = true; reject(new Error(msg.reason)); }
        if (msg.t === 'pong') this.rtt = performance.now() - msg.c;
        const h = this.handlers.get(msg.t);
        if (h) h(msg);
        const any = this.handlers.get('*');
        if (any) any(msg);
      };
      setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
  }
  on(t, fn) { this.handlers.set(t, fn); }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  sendBinary(buf) { if (this.ws && this.ws.readyState === 1 && this.ws.bufferedAmount < 64000) this.ws.send(buf); }
}
