// Dedicated / headless host:  node dist/server.cjs [port] [--debug-all]
import { GameServer } from './GameServer.js';

const port = +(process.argv.find(a => /^\d+$/.test(a)) || 7777);
const debugAll = process.argv.includes('--debug-all');
const token = process.env.CRYPT_HOST_TOKEN || 'dedicated';
const srv = new GameServer({ port, hostToken: token, debugAll });
srv.start().then(() => console.log(`Crypt of Minions dedicated host on ws://0.0.0.0:${port}  (host token: ${token})`));
