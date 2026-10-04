# 开发工具

## `shot.mjs` —— 无头浏览器命令行

拿渲染后的 DOM / 截图 / PDF。**这是本项目做浏览器验证的入口。**

```bash
node tools/shot.mjs <网址或本地文件> [选项]

  --out <文件>     把 DOM 写到文件
  --png <文件>     截图
  --pdf <文件>     打印成 PDF
  --title          只输出页面 <title>（页面常用它回传计算结果）
  --grep <文字>    在 DOM 里搜文字，输出「有/没有」+ 上下文
  --size W,H       窗口尺寸，默认 1280,900
  --wait <毫秒>    虚拟时间预算，默认 5000
  --timeout <毫秒> 进程硬超时，默认 60000
  --browser <路径> 显式指定浏览器
  --quiet          只输出结果
```

例：

```bash
node tools/shot.mjs tests/layout/settings.html --title
node tools/shot.mjs http://127.0.0.1:8899/index.html --png shot.png --size 1440,2000
node tools/shot.mjs http://127.0.0.1:8899/index.html --grep 'drawerWidths'
```

## `browser.mjs` —— 被 shot.mjs 和测试复用的库

```js
import { runHeadless, titleOf, findBrowser } from './tools/browser.mjs';

const r = await runHeadless({ url: 'http://127.0.0.1:8899/x.html', dumpDom: true });
console.log(r.ok, r.dom.length, titleOf(r.dom));
```

## 为什么不用 PowerShell（重要）

这台机器上原本用 `& $msedge --headless=new --dump-dom URL` 做验证，
**经常拿不到任何输出**。查清楚是两个原因叠加：

### ① 你的 Edge 正在运行

Edge 发现已有实例时，会把命令行**转交给那个实例**并弹提示
「请在现有浏览器会话中打开」，headless 根本不执行。
`msedge --version` 返回的就是那句中文提示。

**解决：每次给一个独立的 `--user-data-dir`。**
`browser.mjs` 每次 `mkdtempSync` 一个临时目录，跑完删掉。

### ② PowerShell 拿不到 Edge 的 stdout

`& $edge --dump-dom URL` 在这个环境下返回空；
必须 `Start-Process -RedirectStandardOutput` 才读得到。
而且 PowerShell 的执行策略常禁止运行 `.ps1`（`Invoke-Expression` 绕过去又会
被脚本里的 `&` 和编码问题绊住）。

**解决：用 Node。** `execFile` 读管道干净可靠（已实测）。
所以工具是 `.mjs`。

## 浏览器路径

按顺序找：

1. `CMCC_BROWSER` 环境变量
2. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
3. `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
4. Chrome 的几个常见位置
5. Linux 的 `google-chrome` / `chromium`

> 想指定别的浏览器：`set CMCC_BROWSER=D:\path\to\chrome.exe`

## `fix-hosts.ps1` / `restore-hosts.ps1`

GitHub 连接问题的排查工具，与浏览器验证无关，
详见 [`docs/发布到GitHub.md`](../docs/发布到GitHub.md)。
