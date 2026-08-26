// 打包成可直接塞进 APK assets 的产物：单个 JS + 单个 CSS + index.html
// 打成一个文件是为了避免 WebView 里 file:// 加载 ES module 被 CORS 拦住。
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const res = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife', // 不用 module，file:// 下也能跑
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  outfile: path.join(DIST, 'game.js'),
  metafile: true,
});

await esbuild.build({
  entryPoints: [path.join(ROOT, 'style.css')],
  bundle: true,
  minify: true,
  outfile: path.join(DIST, 'style.css'),
});

// index.html：把 module 脚本换成普通脚本，并去掉开发用的东西
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* 入口与样式都带 ?v=<版本> 的缓存串，替换时要把它一起吃掉，
   否则产物里会留下指向 src/main.js 的引用 —— dist 里根本没有 src/。 */
html = html
  .replace(/<script type="module" src="src\/main\.js(\?[^"]*)?"><\/script>/, '<script src="game.js"></script>')
  .replace(/href="style\.css(\?[^"]*)?"/, 'href="style.css"')
  .replace(/\n\s*<!--[^]*?-->/g, '');
fs.writeFileSync(path.join(DIST, 'index.html'), html);

const size = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1) + ' KB';
const total = fs.readdirSync(DIST).reduce((n, f) => n + fs.statSync(path.join(DIST, f)).size, 0);
console.log('dist/');
for (const f of fs.readdirSync(DIST).sort()) console.log('  ' + f.padEnd(14), size(f));
console.log('  合计          ' + (total / 1024).toFixed(1) + ' KB');
