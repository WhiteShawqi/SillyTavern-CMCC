/**
 * 无头浏览器工具（Node 版）
 *
 * 为什么不用 PowerShell 脚本 / 直接 `& msedge`：
 *   ① PowerShell 对 Edge 的 stdout 管道不可靠，`& $edge --dump-dom` 拿不到输出；
 *      而且执行策略常禁止运行 .ps1。
 *   ② 用户的 Edge 可能正在运行 —— Edge 发现已有实例会把命令**转交给那个实例**
 *      并弹「请在现有浏览器会话中打开」，headless 根本不执行。
 *      所以每次必须给一个**独立的 --user-data-dir**。
 *   ③ Node 的 execFile 能干净地读管道（本机已验证可行）。
 *
 * @module tools/browser
 */

import { execFile } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** 常见浏览器位置（按优先级） */
const CANDIDATES = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];

/** 找一个能用的浏览器 */
export function findBrowser(explicit) {
    if (explicit) {
        if (!existsSync(explicit)) throw new Error('指定的浏览器不存在: ' + explicit);
        return explicit;
    }
    const envPath = process.env.CMCC_BROWSER;
    if (envPath && existsSync(envPath)) return envPath;
    for (const c of CANDIDATES) {
        if (c && existsSync(c)) return c;
    }
    throw new Error('找不到 Edge / Chrome。可用 CMCC_BROWSER 环境变量指定路径。');
}

/**
 * 把 URL 归一化：允许传本地文件路径
 * @param {string} target
 * @returns {string}
 */
export function toUrl(target) {
    if (/^(https?|data|file|about):/i.test(target)) return target;
    const p = resolve(target);
    if (!existsSync(p)) throw new Error('本地文件不存在: ' + p);
    // Windows 路径要转成 file:///C:/...
    return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '');
}

/**
 * 跑一次无头浏览器
 *
 * @param {object} o
 * @param {string} o.url                网址或本地文件路径
 * @param {boolean} [o.dumpDom]         取渲染后的 DOM（默认 true，除非要截图/PDF）
 * @param {string}  [o.screenshot]      截图输出路径
 * @param {string}  [o.pdf]             打印 PDF 输出路径
 * @param {string}  [o.windowSize]      '1280,900'
 * @param {number}  [o.virtualTime]     虚拟时间预算（毫秒），默认 5000
 * @param {number}  [o.timeout]         进程超时（毫秒），默认 60000
 * @param {string}  [o.browser]         显式指定浏览器
 * @param {boolean} [o.keepProfile]     保留配置目录（排查用）
 * @param {string[]}[o.extraArgs]       追加参数
 * @returns {Promise<{ok:boolean, dom:string, stderr:string, code:number, ms:number}>}
 */
export function runHeadless({
    url,
    dumpDom,
    screenshot,
    pdf,
    windowSize = '1280,900',
    virtualTime = 5000,
    timeout = 60000,
    browser,
    keepProfile = false,
    extraArgs = [],
} = {}) {
    const exe = findBrowser(browser);
    const target = toUrl(url);
    const wantDom = dumpDom !== undefined ? !!dumpDom : (!screenshot && !pdf);

    const profile = mkdtempSync(join(tmpdir(), 'dsh-hl-'));
    const args = [
        `--user-data-dir=${profile}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-features=Translate,MediaRouter',
        '--hide-scrollbars',
        '--mute-audio',
        `--window-size=${windowSize}`,
        `--virtual-time-budget=${virtualTime}`,
    ];
    if (screenshot) args.push(`--screenshot=${resolve(screenshot)}`);
    if (pdf) args.push(`--print-to-pdf=${resolve(pdf)}`);
    if (wantDom) args.push('--dump-dom');
    args.push(...extraArgs, target);

    const t0 = Date.now();
    return new Promise((res) => {
        execFile(exe, args, { maxBuffer: 64 * 1024 * 1024, timeout },
            (err, stdout, stderr) => {
                if (!keepProfile) {
                    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
                }
                const dom = stdout || '';
                res({
                    ok: !err && dom.length > 0,
                    dom,
                    stderr: stderr || '',
                    code: err && typeof err.code === 'number' ? err.code : 0,
                    err: err ? String(err.message || err) : '',
                    ms: Date.now() - t0,
                });
            });
    });
}

/** 从 DOM 里取 <title> 内容（页面常用它回传算出来的结果） */
export function titleOf(dom) {
    const m = String(dom || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return '';
    return m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&').trim();
}

/** 从 DOM 里取某个元素的文本（简易，不做完整解析） */
export function textOf(dom, selector) {
    const s = String(dom || '');
    if (selector.startsWith('#')) {
        const id = selector.slice(1);
        const re = new RegExp(`<([a-z0-9]+)[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
        const m = s.match(re);
        return m ? stripTags(m[2]) : '';
    }
    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        const re = new RegExp(`<([a-z0-9]+)[^>]*\\bclass=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
        const m = s.match(re);
        return m ? stripTags(m[2]) : '';
    }
    return '';
}

function stripTags(h) {
    return String(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
