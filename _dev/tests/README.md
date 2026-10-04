# 测试

全部是纯 Node 脚本，**不需要浏览器、不需要起服务器**：

```bash
cd tests
node test_core.mjs        # 核心逻辑
node _inject_e2e.mjs      # 端到端注入
node _cascade_test.mjs    # 三级级联勾选
node _persona_test.mjs    # 多人设预设 + 迁移
node _panel_smoke.mjs     # 设置面板渲染
node _click_test.mjs      # 抽屉展开/收起交互
node _topbar_test.mjs     # 顶部面板渲染
```

## 各文件测什么

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `test_core.mjs` | 286 | 记忆模型、解析器、注入文本、预算、批量删除、`{user}` 宏回归、静态检查 |
| `_inject_e2e.mjs` | 38 | **「AI 到底能不能读到人设和记忆」**——走完整链路，逐项检查请求体 |
| `_cascade_test.mjs` | 32 | 勾 L1 是否带上 L2/L3、半选状态、边界 |
| `_persona_test.mjs` | 35 | 多人设共存、旧数据迁移、脏数据清洗、幂等性 |
| `_panel_smoke.mjs` | 13 | `renderPanel` 不抛错、人设栏/导出栏结构、展开收起 |
| `_click_test.mjs` | 8 | 设置页抽屉：点一次收起、再点展开 |
| `_topbar_test.mjs` | 2 | `mountTopDrawer` + `renderTopPanel` 能渲染出内容 |

合计 **414 项**。

## 为什么要假 DOM

`ui.js` / `topbar.js` 需要 `document`。Edge headless 在这台机器上一直返回空输出，
浏览器验证做不了，所以写了**能真正执行回调的假 DOM**：

- `_click_test.mjs` 会真的触发 click 监听器，验证状态真的变了
- `_panel_smoke.mjs` 会真的跑 `renderPanel`，验证不抛错
- `_cascade_test.mjs` 直接 import `topbar.js` 的纯函数

> ⚠ 假 DOM **不会执行 CSS**，也**不做布局**。
> 所以「样式看起来对不对」这类问题它测不出来 ——
> 之前设置面板展不开（`.inline-drawer-content` 上的 padding 干扰 max-height）
> 就是假 DOM 测不出来、靠真人跑浏览器诊断脚本才定位的。

## 浏览器验证（`tests/layout/`）

上面的都是 Node 假 DOM，**不执行 CSS、不做布局**。
真浏览器验证在 `tests/layout/`：

```bash
node tests/layout/run.mjs        # 一键：同步 + 起服务器 + 跑 + 关
node tests/layout/run.mjs --png  # 顺便存截图
```

| 页面 | 验证 |
|---|---|
| `index.html` | 顶部面板：图标宽度平衡、面板没被压成竖排、三级记忆树渲染 |
| `settings.html` | 设置页抽屉：展开/收起真的切换 display、人设栏与导出栏都在 |

详见 [`layout/README.md`](layout/README.md)。
**涉及样式和布局的改动，一定要跑这个。**

## `_budget_measure.mjs`

不是断言型测试，是**量数据的脚本**：打印一个完整人设 + 20 条记忆实际占多少 token，
用来决定预算默认值。当前实测结论写在 `src/state.js` 的注释里。
