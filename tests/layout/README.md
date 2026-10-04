# 布局验证测试

验证 **顶部面板不会被 `#top-settings-holder` 的 flex 压扁**（即"一个字一行"的竖排 bug）。

## 为什么需要它

CMCC 的顶部面板插进 ST 的 `#top-settings-holder`，那是个 flex 容器：

```css
#top-settings-holder { display: flex; width: var(--sheldWidth); }
.drawer              { display: flex; width: 100%; }
.drawer-content      { display: none; position: absolute; top: var(--topBarBlockSize); }
.drawer-content.openDrawer { display: block; }
```

**关键**：`.drawer-content` 靠 `position: absolute` **脱离 flex 流**，才不会被压扁。
如果扩展的 CSS 不小心覆盖了 `display` 或 `position`，面板就会掉进流里，
被 `--sheldWidth` 挤成一条竖线 —— 每个字一行。

这个测试就是守住这条底线。

## 怎么跑

```bash
# 1. 起静态服务（ES module 在 file:// 下会被 CORS 拦，必须走 http）
cd tests/layout
python -m http.server 8899

# 2. headless Edge 截图 + 读指标
#    把 src/topbar.js 复制过来（模拟 ST 的加载方式）
cp ../../src/topbar.js .

"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --incognito --hide-scrollbars \
  --virtual-time-budget=6000 --window-size=1400,780 \
  --screenshot=_render/panel.png http://127.0.0.1:8899/index.html

# 3. 读断言结果
"C:\...\msedge.exe" --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=6000 --dump-dom http://127.0.0.1:8899/index.html \
  | findstr CMCC_RESULT
```

## 断言

`index.html` 会把结果写进 `document.title`（`--dump-dom` 能读到）：

| 字段 | 期望 | 说明 |
|---|---|---|
| `panelDisplay` | `block` | 未被扩展 CSS 覆盖 |
| `panelPosition` | `absolute` | **未被覆盖（核心）** |
| `headIsSingleLine` | `true` | 标题栏高度 < 60px，即没有竖排 |
| `hostNotStretched` | `true` | host 高度 ≤ 50px，说明面板脱离了流 |
| `okDisplay` / `okPosition` | `true` | 显式断言 |
| `iconCount` | 3 | 2 个占位 + CMCC 自己那个 |
| `openState` | `true` | 可展开 |

一次通过的实测值：

```json
{"panelDisplay":"block","panelPosition":"absolute","panelWidth":462,
 "panelHeight":458,"headHeight":22,"hostHeight":42,"iconCount":3,
 "headIsSingleLine":true,"hostNotStretched":true,
 "okDisplay":true,"okPosition":true,"openState":true}
```

## 注意

`index.html` 里的 CSS 是**最小复刻**，不是 ST 的完整 `style.css`。
只抄了决定布局的那几条规则 —— 目的是隔离验证 `<style>` 与 CMCC 样式的冲突，
而不是还原 ST 的视觉。

测试用的假数据走的是**真实的 `renderTopPanel`**（copied `topbar.js`），
所以它同时也在验证渲染逻辑本身不会抛错。
