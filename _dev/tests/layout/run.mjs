/**
 * 浏览器验证一键跑
 *
 * 做三件事：
 *   ① 同步 src/ 到 tests/layout/
 *   ② 起一个临时 http.server（http.server 拒绝 `..` 穿越，file:// 又因 CORS 挡 ES module，
 *      所以必须起服务器）
 *   ③ 用无头浏览器跑两个页面，把 document.title 里的断言结果读回来
 *
 * 用法: node tests/layout/run.mjs
 *      node tests/layout/run.mjs --png        # 顺便存截图到 tests/layout/_render/
 *      node tests/layout/run.mjs --keep       # 跑完不关服务器（自己看）
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHeadless, titleOf } from '../../tools/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const renderDir = join(here, '_render');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

const wantPng = process.argv.includes('--png');
const keepServer = process.argv.includes('--keep');

// ── ① 同步 ──
console.log('① 同步 src/ → tests/layout/');
execFileSync(process.execPath, [join(here, 'sync.mjs')], { stdio: 'inherit' });

// ── ② 起服务器 ──
console.log(`② 起临时服务器 :${PORT}`);
const py = process.env.CMCC_PYTHON || 'python';
let server = null;
try {
    server = spawn(py, ['-m', 'http.server', String(PORT), '--directory', here], {
        stdio: 'ignore', detached: false,
    });
} catch (e) {
    console.error('起服务器失败:', e.message);
    process.exit(1);
}
await new Promise((r) => setTimeout(r, 1500));

// ── ③ 跑页面 ──
const PAGES = [
    { file: 'index.html', key: 'CMCC_TOPBAR', label: '顶部面板' },
    { file: 'settings.html', key: 'CMCC_SETTINGS', label: '设置页抽屉' },
    { file: 'checkbox.html', key: 'CMCC_CHECKBOX', label: '勾选框样式' },
    { file: 'multiselect.html', key: 'CMCC_MULTISEL', label: '多选级联勾选' },
];

let allOk = true;
const summary = [];

for (const page of PAGES) {
    process.stdout.write(`\n③ ${page.label}  (${page.file})\n`);
    let r;
    try {
        r = await runHeadless({
            url: `${BASE}/${page.file}`,
            dumpDom: true,
            virtualTime: 10000,
            timeout: 60000,
        });
    } catch (e) {
        console.log('  ✗ 浏览器启动失败: ' + e.message);
        allOk = false;
        continue;
    }

    if (!r.dom) {
        console.log('  ✗ 拿不到 DOM');
        if (r.stderr) console.log('    ' + r.stderr.slice(0, 300));
        allOk = false;
        continue;
    }

    const title = titleOf(r.dom);
    const m = title.match(new RegExp(page.key + '=(\\{.*\\})'));
    if (!m) {
        console.log('  ✗ 页面没有回传断言结果（title: ' + title.slice(0, 60) + '）');
        console.log('    说明页面的 JS 抛错了 —— 打开 ' + BASE + '/' + page.file + ' 看控制台');
        allOk = false;
        continue;
    }

    let res;
    try { res = JSON.parse(m[1]); } catch (e) { console.log('  ✗ 结果不是合法 JSON'); allOk = false; continue; }

    const ok = res.ok === true;
    allOk = allOk && ok;
    summary.push({ page: page.file, ok, errors: res.errors || [] });

    console.log('  ' + (ok ? '✓ 全部通过' : '✗ 有失败'));
    // 打印关键断言
    for (const [k, v] of Object.entries(res)) {
        if (k === 'errors' || k === 'ok' || k === 'steps') continue;
        const mark = v === true ? '✓' : (v === false ? '✗' : ' ');
        console.log(`    ${mark} ${k} = ${JSON.stringify(v)}`);
    }
    if (res.errors && res.errors.length) {
        console.log('    错误:');
        res.errors.forEach((e) => console.log('      · ' + e));
    }

    if (wantPng) {
        mkdirSync(renderDir, { recursive: true });
        const png = join(renderDir, page.file.replace('.html', '.png'));
        await runHeadless({
            url: `${BASE}/${page.file}`,
            screenshot: png,
            windowSize: '1280,1200',
            virtualTime: 10000,
        });
        console.log('    📷 ' + png);
    }
}

// ── 收尾 ──
if (server && !keepServer) {
    try { server.kill(); } catch (e) { /* 忽略 */ }
}
if (keepServer && server) {
    console.log(`\n服务器还在跑: ${BASE}/index.html   （Ctrl+C 结束）`);
    await new Promise(() => {});
}

console.log('\n════════════════════════');
if (allOk) {
    console.log('✓ 浏览器验证全部通过');
} else {
    console.log('✗ 浏览器验证有失败');
    summary.forEach((s) => {
        if (!s.ok) console.log(`   · ${s.page}: ${s.errors.join(' / ') || '断言未通过'}`);
    });
}
process.exit(allOk ? 0 : 1);
