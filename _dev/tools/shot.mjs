/**
 * 无头浏览器命令行工具
 *
 * 用法：
 *   node tools/shot.mjs <网址或文件>                      # 打印渲染后的 DOM
 *   node tools/shot.mjs <网址> --out dom.html             # DOM 存文件
 *   node tools/shot.mjs <网址> --png out.png              # 截图
 *   node tools/shot.mjs <网址> --pdf out.pdf              # 打印 PDF
 *   node tools/shot.mjs <网址> --title                    # 只打印 <title>
 *   node tools/shot.mjs <网址> --wait 8000                # 等更久
 *   node tools/shot.mjs <网址> --size 1440,900
 *   node tools/shot.mjs <网址> --grep 关键字              # 在 DOM 里搜关键字
 *
 * 例：
 *   node tools/shot.mjs http://127.0.0.1:8899/index.html --png shot.png
 *   node tools/shot.mjs tests/layout/settings.html --title
 */
import { writeFileSync } from 'node:fs';
import { runHeadless, titleOf, findBrowser } from './browser.mjs';

function usage(code = 0) {
    console.log(readmeText());
    process.exit(code);
}

function readmeText() {
    return `
用法: node tools/shot.mjs <网址或本地文件> [选项]

选项:
  --out <文件>     把渲染后的 DOM 写到文件
  --png <文件>     截图
  --pdf <文件>     打印成 PDF
  --title          只输出页面 <title>（页面常用它回传计算结果）
  --grep <文字>    在 DOM 里搜这段文字，输出「有/没有」并打印周边上下文
  --size W,H       窗口尺寸，默认 1280,900
  --wait <毫秒>    虚拟时间预算，默认 5000
  --timeout <毫秒> 进程硬超时，默认 60000
  --browser <路径> 显式指定浏览器
  --quiet          只输出结果，不加提示

例:
  node tools/shot.mjs http://127.0.0.1:8899/index.html
  node tools/shot.mjs tests/layout/settings.html --title
  node tools/shot.mjs http://127.0.0.1:8899/x.html --png out.png --size 1440,2000
`.trim();
}

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) usage(0);

const target = argv[0];
const opt = { url: target, dumpDom: true };
let outFile = '', grepText = '';

for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
        case '--out': outFile = next(); break;
        case '--png': opt.screenshot = next(); opt.dumpDom = false; break;
        case '--pdf': opt.pdf = next(); opt.dumpDom = false; break;
        case '--title': opt.dumpDom = true; opt._title = true; break;
        case '--grep': grepText = next(); opt.dumpDom = true; break;
        case '--size': opt.windowSize = next(); break;
        case '--wait': opt.virtualTime = parseInt(next(), 10); break;
        case '--timeout': opt.timeout = parseInt(next(), 10); break;
        case '--browser': opt.browser = next(); break;
        case '--keep-profile': opt.keepProfile = true; break;
        case '--quiet': opt._quiet = true; break;
        default:
            console.error('未知选项: ' + a);
            usage(1);
    }
}

try {
    if (!opt._quiet) console.error('浏览器: ' + findBrowser(opt.browser));
    const r = await runHeadless(opt);

    if (!opt._quiet) {
        console.error(`耗时 ${r.ms}ms  退出码 ${r.code}  DOM ${r.dom.length} 字符`);
    }

    if (opt.screenshot || opt.pdf) {
        if (r.code === 0) {
            if (!opt._quiet) console.error('✓ 已生成: ' + (opt.screenshot || opt.pdf));
        } else {
            console.error('✗ 生成失败' + (r.err ? '：' + r.err : ''));
            if (r.stderr) console.error(r.stderr.slice(0, 600));
            process.exit(1);
        }
        process.exit(0);
    }

    if (r.dom.length === 0) {
        console.error('✗ 没拿到任何输出。可能原因：');
        console.error('  · 浏览器路径不对（用 --browser 指定，或设 CMCC_BROWSER）');
        console.error('  · 页面本身打不开');
        if (r.stderr) console.error('stderr:\n' + r.stderr.slice(0, 800));
        process.exit(1);
    }

    if (opt._title) {
        process.stdout.write(titleOf(r.dom) + '\n');
        process.exit(0);
    }

    if (grepText) {
        const hit = r.dom.includes(grepText);
        process.stdout.write((hit ? '✓ 找到' : '✗ 没找到') + ': ' + grepText + '\n');
        if (hit) {
            const i = r.dom.indexOf(grepText);
            process.stdout.write('  上下文: …' + r.dom.slice(Math.max(0, i - 120), i + 160).replace(/\s+/g, ' ') + '…\n');
        }
        process.exit(hit ? 0 : 1);
    }

    if (outFile) {
        writeFileSync(outFile, r.dom, 'utf8');
        if (!opt._quiet) console.error('✓ 已写入: ' + outFile);
    } else {
        process.stdout.write(r.dom);
    }
} catch (e) {
    console.error('✗ ' + (e.message || e));
    process.exit(1);
}
