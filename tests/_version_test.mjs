/**
 * 版本号一致性检查
 *
 * ★ 为什么需要：
 *   index.js 里原来写 `const MANIFEST_VERSION = '1.0.0'`，结果从 v1.0.0 之后
 *   每次发版都忘了改 —— 编辑器「关于」里一直显示 1.0.0，而 manifest 已经 1.3.4。
 *   同一个数字写在两处，早晚会漂。
 *
 *   现在版本号以 manifest.json 为唯一来源（运行时读），index.js 里那个
 *   `VERSION_FALLBACK` 只是读不到时的兜底。这个测试守住三件事：
 *     ① VERSION_FALLBACK 必须等于 manifest.version
 *     ② README 的版本徽章必须等于 manifest.version
 *     ③ package.json（如果有）的 version 也要一致
 *
 * 用法: node tests/_version_test.mjs
 *      node tests/_version_test.mjs --fix    # 自动把不一致的地方改过来
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const FIX = process.argv.includes('--fix');

const read = (p) => readFileSync(p, 'utf8');
const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(read(manifestPath));
const V = manifest.version;

let pass = 0, fail = 0, fixed = 0;
const chk = (ok, msg) => { ok ? (pass++, console.log('  ✓ ' + msg)) : (fail++, console.log('  ❌ ' + msg)); };
const note = (msg) => console.log('    → ' + msg);

console.log(`manifest.json 的版本: ${V}`);
console.log('');

// ── ① index.js 的 VERSION_FALLBACK ──
console.log('【1】index.js 的 VERSION_FALLBACK');
{
    const p = join(root, 'index.js');
    const src = read(p);
    const m = src.match(/const VERSION_FALLBACK = '([^']*)'/);
    chk(!!m, '找得到 VERSION_FALLBACK');
    if (m) {
        if (m[1] === V) {
            chk(true, `值一致（${m[1]}）`);
        } else {
            chk(false, `不一致：index.js 是 ${m[1]}，manifest 是 ${V}`);
            if (FIX) {
                writeFileSync(p, src.replace(
                    `const VERSION_FALLBACK = '${m[1]}'`,
                    `const VERSION_FALLBACK = '${V}'`), 'utf8');
                fixed++;
                note('已改为 ' + V);
            } else {
                note('跑 `node tests/_version_test.mjs --fix` 可以自动改');
            }
        }
    }
    // 不该再有硬编码的 MANIFEST_VERSION 常量
    // ⚠ 要剥掉注释再查 —— 我在注释里解释了旧的
    //   `const MANIFEST_VERSION = '1.0.0'` 这个 bug，不剥的话会误报
    const srcNoComment = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    chk(!/const MANIFEST_VERSION = '\d/.test(srcNoComment),
        '★ MANIFEST_VERSION 不再是硬编码常量（改成运行时读了）');
    chk(src.includes('loadManifestVersion'),
        '★ 有 loadManifestVersion()（运行时读 manifest）');
    chk(src.includes('loadManifestVersion()'),
        '★ 启动时调用了它');
}

// ── ② README 的版本徽章 ──
console.log('');
console.log('【2】README 的版本徽章');
{
    const p = join(root, 'README.md');
    const src = read(p);
    const m = src.match(/badge\/version-([\d.]+)-green/);
    chk(!!m, '找得到版本徽章');
    if (m) {
        if (m[1] === V) {
            chk(true, `值一致（${m[1]}）`);
        } else {
            chk(false, `不一致：README 是 ${m[1]}，manifest 是 ${V}`);
            if (FIX) {
                writeFileSync(p, src.replace(
                    `badge/version-${m[1]}-green`, `badge/version-${V}-green`), 'utf8');
                fixed++;
                note('已改为 ' + V);
            }
        }
    }
}

// ── ③ package.json（主分支没有，有就查）──
console.log('');
console.log('【3】package.json（如果有）');
{
    const p = join(root, 'package.json');
    if (!existsSync(p)) {
        chk(true, '没有 package.json，跳过');
    } else {
        const j = JSON.parse(read(p));
        if (j.version === V) {
            chk(true, `值一致（${j.version}）`);
        } else {
            chk(false, `不一致：package.json 是 ${j.version}，manifest 是 ${V}`);
            if (FIX) {
                j.version = V;
                writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
                fixed++;
                note('已改为 ' + V);
            }
        }
    }
}

// ── ④ 编辑器「关于」里显示的确实是 manifest 的版本 ──
console.log('');
console.log('【4】editor.js 用的是传进来的 version');
{
    const src = read(join(root, 'src', 'editor.js'));
    // index.js 才是传版本号的那一方（openEditor({ version: MANIFEST_VERSION })）
    const idx = read(join(root, 'index.js'));
    chk(/version:\s*MANIFEST_VERSION/.test(idx),
        'index.js 打开编辑器时传了版本号');
    chk(/当前版本 \$\{version/.test(src) || src.includes('当前版本'),
        '编辑器「关于」里显示它');
    // 编辑器自己不该再硬编码版本
    chk(!/1\.\d+\.\d+/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
        '★ editor.js 里没有硬编码的版本号');
}

console.log('');
if (FIX && fixed) console.log(`已自动修正 ${fixed} 处`);
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
