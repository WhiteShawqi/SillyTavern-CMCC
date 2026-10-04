# 浏览器验证

用**真的无头浏览器**跑真实布局和真实 CSS，验证那些假 DOM 测不出来的东西。

## 为什么需要它

Node 里的假 DOM **不执行 CSS、不做布局**。

设置面板「点不开」那个 bug 就是例子：我在 `.inline-drawer-content` 上写了
`padding-top: 6px`，而 `max-height` 限制的是**内容盒子**、padding 加在外面 ——
假 DOM 完全测不出来（它只验证 JS 逻辑），最后靠你在浏览器里跑诊断脚本才定位。

**结论：涉及布局 / 样式 / 真实渲染的问题，必须用真浏览器。**

## 怎么跑

```bash
# 一键（自动同步 + 起服务器 + 跑页面 + 关服务器）
node tests/layout/run.mjs

# 顺便存截图到 tests/layout/_render/
node tests/layout/run.mjs --png

# 跑完不关服务器，自己打开看
node tests/layout/run.mjs --keep
```

它会打印：

```
③ 顶部面板  (index.html)
  ✓ 全部通过
    ✓ drawerExists = true
      drawerWidths = [164,164,164,164,164]
    ✓ widthsBalanced = true
    ...
```

## 手动跑单个页面

```bash
node tests/layout/sync.mjs          # 先从 src/ 复制依赖过来
node tools/shot.mjs tests/layout/settings.html --title     # 只取断言结果
node tools/shot.mjs http://127.0.0.1:8899/index.html --png shot.png   # 截图
```

## 两个页面各验证什么

### `index.html` —— 顶部面板（`renderTopPanel`）

| 断言 | 守住什么 |
|---|---|
| `drawerWidths` 各项接近 | **图标错位**：我们的 drawer 不能把别人挤歪<br>（曾经写过 `flex:0 0 auto`，实测 `[…,688]`，最后一个独占宽） |
| `panelPosition === 'absolute'` | **面板被压成竖排**：`.drawer-content` 靠 absolute 脱离 flex 流，<br>一旦被覆盖（曾在 `.cmcc-top-head` 写 `position:sticky`）就掉回流里被挤成一条竖线 |
| `panelWideEnough`（≥380px） | 同上，宽度不够就是竖排的前兆 |
| `bodyChildren > 0` | 面板内容真的渲染出来了 |
| `hasWorldRow` / `hasSaveRow` / `hasEntryRow` | 记忆树三级都在 |

### `settings.html` —— 设置页抽屉（`renderPanel`）

| 断言 | 守住什么 |
|---|---|
| `initExpanded` | 首屏是展开的 |
| `collapseHidden` | 点一次：`display:none` 且高度 0 |
| `expandRestored` | 再点：`display:block` 且高度回来 |
| `reCollapseHidden` | 第三次：又收起来 |
| `chevToggles` | 箭头跟着切 |
| `hasPersonaBar` / `personaOptions` / `bars` | 人设预设栏 + 导出导入栏都在 |

> **这里刻意不复刻动画。** ST 自己的 `toggleDrawer` 就是纯 `display` 切换，
> 我之前自作聪明加的 `max-height` 动画反而是 bug 源头。

## 关键实现细节（踩过的坑）

1. **必须用独立 `--user-data-dir`**
   你的 Edge 正在运行时，Edge 会把命令**转交给那个实例**并弹
   「请在现有浏览器会话中打开」，headless 根本不执行 → 拿不到任何输出。
   见 `tools/browser.mjs`，它每次生成一个临时配置目录并跑完删掉。

2. **必须用 Node 起进程，不能用 PowerShell 的 `&`**
   `& $msedge --dump-dom URL` 在这个环境下**拿不到 stdout**，
   而且要显式 `-RedirectStandardOutput` 才行。
   Node 的 `execFile` 读管道干净可靠，所以工具是 `.mjs` 不是 `.ps1`。

3. **测试页只能 import 同目录文件**
   `http.server` 拒绝 `..` 目录穿越；`file://` 又因 CORS 挡 ES module。
   所以 `sync.mjs` 把 `src/*.js` 和 `style.css` 复制到 `tests/layout/`。
   **这些副本已写进 `.gitignore`，不入库**，改了 src 后重新 sync 即可。

4. **页面把断言结果写进 `document.title`**
   格式 `CMCC_TOPBAR={...}` / `CMCC_SETTINGS={...}`，
   用 `tools/shot.mjs ... --title` 就能读回来。
   同时也会渲染到页面上（`#cmcc_result`），方便人眼看。

5. **测试页里的 `api` 必须和 `index.js` 真正暴露的一致**
   少一个方法 `renderPanel` 就会抛错 —— 旧版这个页面就是这么坏掉的
   （加了人设预设功能后，页面里的 api 没有 `listPersonas`）。
