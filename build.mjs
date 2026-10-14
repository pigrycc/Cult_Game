// Build pipeline:  node build.mjs                → dist/ (client bundle, electron main, dedicated server)
//                  node build.mjs --package      → also release/CryptOfMinions-win32-x64.zip (portable .exe)
//                  node build.mjs --package-mac  → release/CryptOfMinions-macOS-universal.zip (Apple Silicon + Intel).
//                                                  MUST run on macOS: needs lipo (universal merge), codesign and ditto.
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

const wantWin = process.argv.includes('--package'), wantMac = process.argv.includes('--package-mac');
if (wantWin) {
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

if (wantMac) {
  if (process.platform !== 'darwin') { console.error('--package-mac must run on macOS (universal merge + ad-hoc codesign + ditto).'); process.exit(1); }
  const APP = 'Crypt of Minions', stage = 'build/mac-app', out = 'build/mac-out';
  fs.rmSync('build/mac-app', { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync('dist', stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'crypt-of-minions', productName: APP, version: pkg.version, description: pkg.description, main: 'main.cjs', author: pkg.author }, null, 2));
  const ev = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version;
  const plist = path.resolve('assets/mac/Info.extra.plist');
  execSync(`npx electron-packager ${stage} "${APP}" --platform=darwin --arch=universal --electron-version=${ev} --out=${out} --overwrite --asar `
    + `--app-bundle-id=com.cryptdev.cryptofminions --app-category-type=public.app-category.games --app-copyright="Crypt Dev Team" `
    + `--extend-info="${plist}" --extend-helper-info="${plist}"`, { stdio: 'inherit' });
  const dir = fs.readdirSync(out).find(d => d.startsWith(APP) && d.includes('darwin'));
  const appPath = path.join(out, dir, `${APP}.app`);
  // Apple Silicon refuses code whose signature is missing or was invalidated by repackaging → re-sign ad hoc.
  // (No Apple Developer ID here, so the app is not notarized: first launch needs the Gatekeeper override in README_MAC.txt.)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, { stdio: 'inherit' });
  const exe = path.join(appPath, 'Contents/MacOS', APP);
  console.log('architectures in main executable:', execSync(`lipo -archs "${exe}"`).toString().trim());
  fs.writeFileSync('build/mac-app-path.txt', appPath);
  if (process.argv.includes('--no-zip')) process.exit(0);
  const pack = path.join(out, 'CryptOfMinions-macOS');
  fs.mkdirSync(pack, { recursive: true });
  execSync(`ditto "${appPath}" "${path.join(pack, APP + '.app')}"`);                 // ditto keeps symlinks, modes and xattrs intact
  fs.copyFileSync('docs/README_MAC.txt', path.join(pack, 'README_MAC.txt'));
  fs.mkdirSync('release', { recursive: true });
  const zip = path.resolve('release/CryptOfMinions-macOS-universal.zip');
  fs.rmSync(zip, { force: true });
  execSync(`ditto -c -k --sequesterRsrc --keepParent "${pack}" "${zip}"`);
  console.log('Packaged →', zip, (fs.statSync(zip).size / 1e6).toFixed(1) + ' MB');
}
