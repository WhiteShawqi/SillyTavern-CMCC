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

const FILES = [
    'ui.js', 'topbar.js', 'inject.js', 'state.js', 'store.js', 'memo.js', 'summary.js',
    // v1.3.3：弹出式编辑器 + 共享的勾选状态
    'editor.js', 'selection.js',
];

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

// ★ 顺便拷一份**真实的 ST style.css**
//   为什么需要：用户报「按钮竖着排」，根因在 ST 的
//       .menu_button { width: min-content }
//   —— 只引我们自己的 style.css 根本量不出这个问题，
//   按钮尺寸测试就成了摆设。所以必须引真样式。
//   这个文件也写进 .gitignore（140 KB，不该入库）。
const ST_CANDIDATES = [
    process.env.CMCC_ST_DIR,
    'F:/PRTS AI/SillyTavern/public/style.css',
].filter(Boolean);
let gotSt = false;
for (const c of ST_CANDIDATES) {
    try {
        if (existsSync(c)) {
            copyFileSync(c, join(here, 'st-style.css'));
            n++;
            gotSt = true;
            console.log('  ✓ 已拷真实 ST 样式: ' + c);
            break;
        }
    } catch (e) { /* 试下一个 */ }
}
if (!gotSt) {
    console.log('  ⚠ 没找到 ST 的 style.css —— 按钮尺寸测试会失真。');
    console.log('    可以用 CMCC_ST_DIR 环境变量指定它的路径。');
}

console.log(`✓ 已同步 ${n} 个文件到 tests/layout/`);
