// Build pipeline:  node build.mjs            → dist/ (client bundle, electron main, dedicated server)
//                  node build.mjs --package  → also release/CryptOfMinions-win32-x64.zip (portable .exe)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/client', { recursive: true });

const common = { bundle: true, logLevel: 'info', legalComments: 'none' };
await esbuild.build({ ...common, entryPoints: ['src/client/main.js'], outfile: 'dist/client/bundle.js', format: 'esm', platform: 'browser', target: 'chrome120', minify: true, sourcemap: false });
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join('src/client', f), path.join('dist/client', f));
const nodeOpts = { ...common, platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'bufferutil', 'utf-8-validate'] };
await esbuild.build({ ...nodeOpts, entryPoints: ['src/main/main.js'], outfile: 'dist/main.cjs' });
await esbuild.build({ ...nodeOpts, entryPoints: ['src/main/preload.js'], outfile: 'dist/preload.cjs' });
await esbuild.build({ ...nodeOpts, entryPoints: ['src/server/standalone.js'], outfile: 'dist/server.cjs' });
console.log('dist/ ready');

if (process.argv.includes('--package')) {
  const stage = 'build/app';
  fs.rmSync('build', { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync('dist', stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'crypt-of-minions', productName: 'CryptOfMinions', version: pkg.version, description: pkg.description, main: 'main.cjs', author: pkg.author }, null, 2));
  const ev = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version;
  execSync(`npx electron-packager ${stage} CryptOfMinions --platform=win32 --arch=x64 --electron-version=${ev} --out=build/out --overwrite --asar --app-copyright="Crypt Dev Team"`, { stdio: 'inherit' });
  const outDir = 'build/out/CryptOfMinions-win32-x64';
  fs.copyFileSync('docs/README_PLAYERS.txt', path.join(outDir, 'README.txt'));
  fs.copyFileSync('dist/server.cjs', path.join(outDir, 'dedicated-server.cjs'));
  fs.mkdirSync('release', { recursive: true });
  const zip = path.resolve('release/CryptOfMinions-win32-x64.zip');
  fs.rmSync(zip, { force: true });
  execSync(`cd build/out && zip -qr -9 "${zip}" CryptOfMinions-win32-x64`, { stdio: 'inherit' });
  console.log('Packaged →', zip, (fs.statSync(zip).size / 1e6).toFixed(1) + ' MB');
}
