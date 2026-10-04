# 布局验证测试

验证 CMCC 顶部面板与图标的两个关键布局问题。**这两条都实际出过 bug。**

## 为什么需要它

CMCC 的顶部入口插进 ST 的 `#top-settings-holder`，那里的布局是：

```css
#top-settings-holder { display: flex; justify-content: center; width: var(--sheldWidth); }
.drawer              { display: flex; flex-flow: row; width: 100%; }
.drawer-content      { display: none; position: absolute; top: var(--topBarBlockSize); }
.drawer-content.openDrawer { display: block; }
```

### 坑 1：面板被压扁成竖排

`.drawer-content` 靠 `position: absolute` **脱离 flex 流**。
如果扩展 CSS 覆盖了 `display` 或 `position`，面板就掉进流里，
被 `--sheldWidth` 挤成一条竖线 —— **每个字一行**。

> 实际触发原因：在 `.cmcc-top-head` 上写了 `position: sticky`，
> sticky 在未显式指定 position 的父级下退化成相对定位，把面板拉回了流里。

### 坑 2：图标错位

每个 `.drawer` 都是 `width: 100%`，**靠 flex 默认的 `shrink` 平摊成一排**。
一旦给我们的 drawer 加 `flex: 0 0 auto`（禁止收缩），它会独占 100% 宽，
图标被挤到最右边。

> 实测：`drawerWidths: [38,46,41,46,44,41,47,47,36,688]` —— 最后一个 688px 就是 CMCC。

## 怎么跑

```bash
cd tests/layout
cp ../../src/topbar.js .          # 模拟 ST 的加载方式
cp ../../style.css .              # 测试页要引用它（见下方"注意"）
python -m http.server 8899

"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --incognito --hide-scrollbars \
  --virtual-time-budget=6000 --window-size=1400,780 \
  --screenshot=_render/panel.png http://127.0.0.1:8899/index.html

# 读断言（结果写在 document.title 里）
"C:\...\msedge.exe" --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=6000 --dump-dom http://127.0.0.1:8899/index.html
```

## 断言

| 字段 | 期望 | 守住什么 |
|---|---|---|
| `panelPosition` | `absolute` | **坑 1**：未被覆盖，面板脱离 flex 流 |
| `panelDisplay` | `block` | 同上 |
| `headIsSingleLine` | `true` | 标题栏 < 60px，说明没竖排 |
| `hostNotStretched` | `true` | host 高度 ≤ 50px，面板确实脱离流 |
| `drawerWidths` | 各项**彼此接近** | **坑 2**：图标等宽不错位 |
| `iconCount` / `drawerCount` | 10 | CMCC 图标插入成功 |
| `openState` | `true` | 可展开 |
| `bodyChildCount` | > 0 | 面板内容真的渲染出来了 |

一次通过的实测值：

```json
{"panelDisplay":"block","panelPosition":"absolute","panelWidth":586,
 "headHeight":27,"hostHeight":42,"iconCount":10,
 "drawerCount":10,"drawerWidths":[69,69,69,69,69,69,69,69,69,69],
 "headIsSingleLine":true,"hostNotStretched":true,
 "okDisplay":true,"okPosition":true,"openState":true}
```

## 注意（踩过的坑）

1. **`file://` 下 ES module 会被 CORS 拦** —— 必须走 http。
2. **`http.server` 不允许 `..` 路径穿越** —— 测试页原来写
   `<link href="../style.css">` 会 404，导致**扩展 CSS 根本没被加载**，
   而当时的断言仍然"通过"（因为 ST 基础样式足够让面板显示）。
   → 所以现在把 `style.css` 复制一份到 `tests/layout/` 里引用。
   **跑之前记得同步**（或用脚本自动复制）。
3. **测试页的 CSS 是最小复刻**，不是 ST 的完整 `style.css`。
   只抄决定布局的那几条 —— 目的是隔离验证样式冲突，不是还原视觉。
4. 假数据走的是**真实的 `renderTopPanel`**，所以它同时在验证渲染逻辑不抛错。
