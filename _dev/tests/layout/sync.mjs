/**
 * 把 src/ 同步到 tests/layout/，供浏览器测试页 import
 *
 * 为什么要复制：http.server 拒绝 `..` 目录穿越，file:// 又因 CORS 不允许 ES module，
 * 所以测试页只能 import 同目录下的文件。
 *
 * 这些副本都写进 .gitignore，不入库。
 *
 * 用法: node tests/layout/sync.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = join(root, 'src');

const FILES = ['ui.js', 'topbar.js', 'inject.js', 'state.js', 'store.js', 'memo.js', 'summary.js'];

mkdirSync(srcDir, { recursive: true });
mkdirSync(here, { recursive: true });

let n = 0;
for (const f of FILES) {
    const from = join(srcDir, f);
    if (!existsSync(from)) { console.log('  跳过（不存在）: src/' + f); continue; }
    copyFileSync(from, join(here, f));
    n++;
}
// 样式
copyFileSync(join(root, 'style.css'), join(here, 'style.css'));
n++;
console.log(`✓ 已同步 ${n} 个文件到 tests/layout/`);
