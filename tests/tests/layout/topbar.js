/**
 * CMCC · 酒馆顶部入口（抽屉面板）
 *
 * 位置：注入到 `#top-settings-holder`（与 AI配置 / 世界书 / 扩展 同一排图标）
 *
 * 机制说明（踩过的坑）：
 *   ST 里 `.drawer-opener` 是**委托绑定**（script.js:12086），但 `.drawer-toggle`
 *   是**静态绑定**（script.js:12088 `$('.drawer-toggle').on('click', ...)`），
 *   在 DOM ready 时就绑完了 —— 扩展后加的 toggle 收不到事件。
 *   → 所以自己实现点击逻辑（照抄 ST 的 doNavbarIconClick 行为），不依赖委托。
 *
 * 面板内容：改「陪伴角色人设」+「记忆」
 * 切换是哪个角色做陪伴者 → 在扩展设置页（和酒馆助手同位置）
 */

const DRAWER_ID = 'cmcc-top-drawer';
const PANEL_ID = 'cmcc-top-panel';
const LOG_TAG = '[CMCC]';

/**
 * 「弹窗类」元素选择器 —— 这些挂在面板外面，点它们不算「点面板外」
 * （否则 callGenericPopup 的取消按钮会把整个抽屉关掉）
 */
const POPUP_SELECTOR = [
    '.popup', '#movingDivs', '.dialogue_popup', '.popup_body',
    '.toast', '#toast-container', '.select2-container',
    '.ui-dialog', '.swal2-container', '#character_popup',
].join(',');

/** 重渲染钩子：由 index.js 注册（避免 topbar 反向依赖 index） */
let RENDER_HOOK = null;
export function setRenderHook(fn) { RENDER_HOOK = fn; }

/**
 * 记忆列表的折叠状态（模块级，重渲染后保持）
 * 键形如 'w:char:x.png' / 's:char:x.png|存档1'
 * 集合里存在 = **已收起**
 *
 * 设计：**默认全部展开**，只有用户点了才收起。
 * （试过"首次自动只展开当前项"，但那会导致重渲染时展开状态莫名其妙变化，
 *   用户会以为界面在乱跳 —— 保持简单可预测更好。想要精简视图用「只看当前」。）
 */
const COLLAPSED = new Set();

function toggleCollapsed(key) {
    if (COLLAPSED.has(key)) COLLAPSED.delete(key);
    else COLLAPSED.add(key);
}

/** 展开某个键 */
export function expandKey(key) { COLLAPSED.delete(key); }

// ── 多选模式（模块级，重渲染后保持）──
/** 是否处于多选模式 */
let SELECT_MODE = false;
/** 已勾选的记忆，键形如 'w\u0000s\u00003'（世界+存档+下标），跨存档全局唯一 */
const SELECTED = new Set();
/** 已勾选的整个世界（世界 key），删的时候整个一起删 */
const SELECTED_WORLDS = new Set();
/** 已勾选的整个存档，键形如 'w\u0000s' */
const SELECTED_SAVES = new Set();

/** 组合一条记忆的唯一键 */
/**
 * 仅供测试：暴露三个勾选集合与「进入/退出多选」开关。
 * 生产代码不要用。
 * @internal
 */
export const __selTestHook = {
    SELECTED, SELECTED_SAVES, SELECTED_WORLDS,
    clear() { SELECTED.clear(); SELECTED_SAVES.clear(); SELECTED_WORLDS.clear(); },
    setMode(v) { SELECT_MODE = !!v; },
    getMode() { return SELECT_MODE; },
};

export function entryKey(wKey, sKey, idx) {
    return wKey + '\u0000' + sKey + '\u0000' + idx;
}

/** 拆回 [wKey, sKey, idx] */
export function parseEntryKey(k) {
    const [w, s, i] = k.split('\u0000');
    return [w, s, parseInt(i, 10)];
}

/** 存档的勾选键（三级里 L2 用） */
export function saveKeyId(wKey, sKey) {
    return 's:' + wKey + '|' + sKey;
}

// ─────────────────────────────────────────────
// 三级级联勾选
//
// 用户反馈的问题：勾了「世界」（L1）却没有把下面的存档和记忆一起勾上，
// 勾了「存档」（L2）也没有带上 L3 —— 显示上"已选 1 个世界"但条目都没勾，
// 看起来像"非正常全选"。
//
// 规则：
//   · 勾 L1 → 它下面所有 L2、L3 全部勾上
//   · 勾 L2 → 它下面所有 L3 全部勾上
//   · 取消同理，逐层清掉
//   · L2 复选框：自己的整档选了 → 勾上；部分 L3 选了 → 半选
//   · L1 复选框：整个世界的档全选 → 勾上；部分 → 半选
// ─────────────────────────────────────────────

/** 把某个存档下所有记忆加进 / 移出 SELECTED */
export function setSaveEntries(wKey, sKey, on, worlds) {
    const w = worlds?.[wKey];
    const n = w?.saves?.[sKey]?.entries?.length || 0;
    for (let i = 0; i < n; i++) {
        const k = entryKey(wKey, sKey, i);
        if (on) SELECTED.add(k); else SELECTED.delete(k);
    }
}

/** 把某个世界下所有存档、记忆加进 / 移出 */
export function setWorldAll(wKey, on, worlds) {
    const w = worlds?.[wKey];
    if (!w?.saves) return;
    for (const sKey of Object.keys(w.saves)) {
        const id = saveKeyId(wKey, sKey);
        if (on) SELECTED_SAVES.add(id); else SELECTED_SAVES.delete(id);
        setSaveEntries(wKey, sKey, on, worlds);
    }
}

/** 某个存档的勾选状态：'all' | 'some' | 'none' */
export function saveSelState(wKey, sKey, worlds) {
    const n = worlds?.[wKey]?.saves?.[sKey]?.entries?.length || 0;
    if (!n) return SELECTED_SAVES.has(saveKeyId(wKey, sKey)) ? 'all' : 'none';
    let hit = 0;
    for (let i = 0; i < n; i++) if (SELECTED.has(entryKey(wKey, sKey, i))) hit++;
    if (hit === 0) return SELECTED_SAVES.has(saveKeyId(wKey, sKey)) ? 'all' : 'none';
    return hit === n ? 'all' : 'some';
}

/** 某个世界的勾选状态：'all' | 'some' | 'none' */
export function worldSelState(wKey, worlds) {
    const w = worlds?.[wKey];
    if (!w?.saves) return 'none';
    const keys = Object.keys(w.saves);
    if (!keys.length) return SELECTED_WORLDS.has(wKey) ? 'all' : 'none';
    let all = 0, some = 0;
    for (const sKey of keys) {
        const st = saveSelState(wKey, sKey, worlds);
        if (st === 'all') all++;
        else if (st === 'some') some++;
    }
    if (all === keys.length) return 'all';
    if (all || some) return 'some';
    return 'none';
}

/**
 * 判断记忆世界书是否已挂载（全局选中 或 当前角色的附加世界书）
 * ST 只读「外部世界书文件」，卡内嵌的不生效 —— 所以要提醒用户挂载。
 */
export function isWorldBookActive(ctx, bookName) {
    if (!bookName) return true;
    try {
        const s = ctx.powerUserSettings || {};
        const wi = s.world_info_settings || {};
        const globals = wi.world_info?.globalSelect || s.world_info?.globalSelect || [];
        if (Array.isArray(globals) && globals.includes(bookName)) return true;
    } catch (e) { /* ignore */ }
    try {
        // 角色的附加世界书挂在 world_info_character_books[fileName] = [names]
        const s = ctx.powerUserSettings || {};
        const map = s.world_info_character_books || {};
        const ch = (ctx.characters || [])[ctx.characterId];
        const file = ch?.avatar;
        if (file && Array.isArray(map[file]) && map[file].includes(bookName)) return true;
    } catch (e) { /* ignore */ }
    try {
        // 当前聊天的主世界书
        const meta = ctx.chatMetadata || {};
        if (meta.world_info === bookName) return true;
    } catch (e) { /* ignore */ }
    return false;
}

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}

/**
 * 建抽屉骨架（幂等）
 * 若已存在但**不完整**（缺 body，例如 ST 重建过 DOM），会拆掉重建 ——
 * 否则会出现"图标在、面板只有标题、body 永远为空"的静默故障。
 */
export function mountTopDrawer() {
    const exist = document.getElementById(DRAWER_ID);
    if (exist) {
        const okDrawer = !!exist.querySelector('.drawer-toggle');
        const okPanel = !!document.getElementById(PANEL_ID);
        const okBody = !!document.getElementById(PANEL_ID + '_body');
        if (okDrawer && okPanel && okBody) return;   // 完整，不用动
        console.warn(LOG_TAG, '抽屉骨架不完整，拆掉重建', { okDrawer, okPanel, okBody });
        exist.remove();
    }

    const drawer = el('div', 'drawer');
    drawer.id = DRAWER_ID;

    // 图标
    const toggle = el('div', 'drawer-toggle');
    const icon = el('div',
        'drawer-icon fa-solid fa-people-arrows fa-fw closedIcon cmcc-top-icon');
    icon.id = 'cmcc_drawer_icon';
    icon.title = '跨世界陪伴角色（人设 / 记忆）';
    toggle.appendChild(icon);
    drawer.appendChild(toggle);

    // 自实现点击（ST 的静态绑定覆盖不到后加的节点）
    toggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (isTopPanelOpen()) {
            closeDrawer();
        } else {
            openTopPanel();
            // 自愈：打开时若 body 意外为空（ST 重建过 DOM 等），补渲染一次
            const b = document.getElementById(PANEL_ID + '_body');
            if (b && b.children.length === 0) {
                console.warn(LOG_TAG, '打开时发现面板为空，触发补渲染');
                try { RENDER_HOOK?.(); } catch (e) { console.error(LOG_TAG, e); }
            }
        }
    });

    // 面板
    const panel = el('div', 'drawer-content closedDrawer cmcc-top-panel');
    panel.id = PANEL_ID;
    const head = el('div', 'cmcc-top-head');
    head.innerHTML = '<b>跨世界陪伴角色</b>';
    const closeBtn = el('button', 'cmcc-top-close', '×');
    closeBtn.title = '关闭';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeDrawer();
    };
    head.appendChild(closeBtn);

    // 诊断：右键点标题 → 把内部状态复制到剪贴板（不用开 F12）
    head.title = '右键点这里可复制诊断信息';
    head.addEventListener('contextmenu', async (ev) => {
        ev.preventDefault();
        const info = collectDiagnostics(ctx, api);
        const txt = JSON.stringify(info, null, 2);
        try {
            await navigator.clipboard.writeText(txt);
            ctx.toastr?.success?.('诊断信息已复制到剪贴板');
        } catch (e) {
            // 剪贴板不可用时退化为控制台 + 弹窗
            console.log('[CMCC] 诊断', info);
            try { await ctx.callGenericPopup('诊断信息（控制台也有）：\n\n' + txt, ctx.POPUP_TYPE.TEXT); }
            catch (_) { ctx.toastr?.info?.('诊断信息已打印到控制台'); }
        }
    });

    panel.appendChild(head);

    const body = el('div', 'cmcc-top-body');
    body.id = PANEL_ID + '_body';
    panel.appendChild(body);

    drawer.appendChild(panel);

    const host = document.getElementById('top-settings-holder');
    if (host) host.appendChild(drawer);
    else document.body.appendChild(drawer);   // 兜底

    // 点面板外面收起（跟 ST 其他抽屉一致的体验）
    document.addEventListener('mousedown', (ev) => {
        if (!isTopPanelOpen()) return;
        const t = ev.target;
        if (!t || typeof t.closest !== 'function') return;
        if (drawer.contains(t)) return;          // 点自己面板：不关
        if (t.closest('#' + DRAWER_ID)) return;
        // ⚠ 弹窗（callGenericPopup / toastr / 下拉）挂在面板**外面**，
        //   点它的「取消」不该把整个抽屉收起来（曾经的 bug）。
        if (t.closest(POPUP_SELECTOR)) return;
        closeDrawer();                            // 点任何其它地方都收起
    });
    // Esc：有弹窗时让弹窗自己处理，别抢
    document.addEventListener('keydown', (ev) => {
        if (!isTopPanelOpen()) return;
        if (ev.key !== 'Escape') return;
        if (document.querySelector(POPUP_SELECTOR)) return;
        closeDrawer();
    });
}

/**
 * 收集诊断信息（供"右键标题复制"使用）
 * 目的：让用户不用开 F12 就能提供可定位的信息
 */
export function collectDiagnostics(ctx, api) {
    const out = {
        时间: new Date().toISOString(),
        图标栏抽屉数: document.querySelectorAll('#top-settings-holder > .drawer').length,
        各抽屉宽度: [...document.querySelectorAll('#top-settings-holder > .drawer')]
            .map((d) => Math.round(d.getBoundingClientRect().width)),
        CMCC面板存在: !!document.getElementById(PANEL_ID),
        面板class: document.getElementById(PANEL_ID)?.className || null,
        面板宽高: (() => {
            const p = document.getElementById(PANEL_ID);
            if (!p) return null;
            const r = p.getBoundingClientRect();
            return [Math.round(r.width), Math.round(r.height)];
        })(),
        面板计算样式: (() => {
            const p = document.getElementById(PANEL_ID);
            if (!p) return null;
            const cs = getComputedStyle(p);
            return { display: cs.display, position: cs.position, height: cs.height, overflow: cs.overflowY };
        })(),
        body存在: !!document.getElementById(PANEL_ID + '_body'),
        body子元素数: document.getElementById(PANEL_ID + '_body')?.children.length ?? -1,
        body高度: Math.round(document.getElementById(PANEL_ID + '_body')?.getBoundingClientRect().height || 0),
        body文本前80字: (document.getElementById(PANEL_ID + '_body')?.textContent || '').trim().slice(0, 80),
    };
    try {
        const snap = api.snapshot();
        out.快照 = {
            bookName: snap.bookName,
            companionAvatar: snap.companionAvatar || '(空)',
            worldCount: snap.stats?.worldCount,
            totalEntries: snap.stats?.totalEntries,
        };
    } catch (e) {
        out.快照错误 = String(e && e.message || e);
    }
    try {
        const pos = api.currentPos();
        out.当前位置 = { world: pos.wLabel, save: pos.sKey };
    } catch (e) {
        out.位置错误 = String(e && e.message || e);
    }
    out.角色卡总数 = (ctx.characters || []).length;
    return out;
}

function closeDrawer() {
    const panel = document.getElementById(PANEL_ID);
    const icon = document.getElementById('cmcc_drawer_icon');
    if (panel) { panel.classList.remove('openDrawer'); panel.classList.add('closedDrawer'); }
    if (icon) { icon.classList.remove('openIcon'); icon.classList.add('closedIcon'); }
}

/** 面板是否可见 */
export function isTopPanelOpen() {
    return !!document.getElementById(PANEL_ID)?.classList.contains('openDrawer');
}

/** 打开面板 */
export function openTopPanel() {
    const panel = document.getElementById(PANEL_ID);
    const icon = document.getElementById('cmcc_drawer_icon');
    if (panel) { panel.classList.remove('closedDrawer'); panel.classList.add('openDrawer'); }
    if (icon) { icon.classList.remove('closedIcon'); icon.classList.add('openIcon'); }
}

// （这里原本挂了一个 click 监听器，但回调体是空的 —— 什么也没做。
//   已删除：既没用，又让本模块在模块顶层依赖 document，
//   导致纯逻辑测试无法在 Node 里导入它。）

// ─────────────────────────────────────────────
// 渲染面板内容
// ─────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object} o.ctx
 * @param {object} o.api       index.js 暴露的操作
 * @param {() => void} o.onGotoSettings  跳去设置页切换陪伴者
 */
export function renderTopPanel({ ctx, api, onGotoSettings }) {
    // 健壮性：若骨架不在（ST 重建过 DOM / 首次加载时序），先补建
    let body = document.getElementById(PANEL_ID + '_body');
    if (!body) {
        mountTopDrawer();
        body = document.getElementById(PANEL_ID + '_body');
    }
    if (!body) {
        // 仍然没有：说明 host 结构异常，把原因留在控制台而不是静默失败
        console.error(LOG_TAG, '找不到面板容器', {
            drawer: !!document.getElementById(DRAWER_ID),
            panel: !!document.getElementById(PANEL_ID),
            host: !!document.getElementById('top-settings-holder'),
        });
        return;
    }
    body.innerHTML = '';

    let snap;
    try { snap = api.snapshot(); } catch (e) {
        console.error(LOG_TAG, 'snapshot 失败', e);
        body.appendChild(el('div', 'cmcc-empty', '读取失败：' + String(e && e.message || e)));
        return;
    }

    const isBuiltin = snap.personaMode === 'builtin';
    const comp = isBuiltin
        ? null
        : (ctx.characters || []).find((c) => c && c.avatar === snap.companionAvatar);
    const compName = isBuiltin
        ? (snap.companionName || '（未填写人设）')
        : (comp?.name || '（未选择陪伴角色）');

    // ── 当前陪伴者 ──
    const who = el('div', 'cmcc-top-who');
    who.innerHTML = `<span class="cmcc-top-who-label">当前陪伴者</span>`
        + `<span class="cmcc-top-who-name">${compName}</span>`
        + `<span class="cmcc-top-who-tag">${isBuiltin ? '内置' : '角色卡'}</span>`;
    const switchBtn = el('button', 'menu_button cmcc-mini', '切换 →');
    switchBtn.title = '到扩展设置页切换（和酒馆助手同位置）';
    switchBtn.onclick = () => { closeDrawer(); onGotoSettings(); };
    who.appendChild(switchBtn);
    body.appendChild(who);

    // 没设好陪伴者：给明确引导
    if (!snap.hasCompanion) {
        const tip = el('div', 'cmcc-top-section cmcc-empty-state');
        tip.innerHTML = isBuiltin
            ? [
                '<div style="font-weight:bold;margin-bottom:6px;">还没填写内置人设</div>',
                '<div style="opacity:.85;line-height:1.7;">',
                '① 点「切换 →」跳到扩展设置<br>',
                '② 在「内置角色（独立）」里写名字和描述<br>',
                '③ 勾上「启用」<br>',
                '④ 回来这里就能看到人设和记忆（不用挂世界书）',
                '</div>',
            ].join('')
            : [
                '<div style="font-weight:bold;margin-bottom:6px;">还没有选择陪伴角色</div>',
                '<div style="opacity:.85;line-height:1.7;">',
                '① 点「切换 →」跳到扩展设置<br>',
                '② 在「用已有角色卡」里选一张卡（或用「+ 创建新角色」）<br>',
                '③ 勾上「启用」<br>',
                '④ 建议把 <code>CMCC-记忆库</code> 勾起「全局」，AI 才读得到',
                '</div>',
            ].join('');
        body.appendChild(tip);

        const tools0 = el('div', 'cmcc-btns');
        const bGo = el('button', 'menu_button cmcc-wide-btn', '去设置');
        bGo.onclick = () => { closeDrawer(); onGotoSettings(); };
        tools0.appendChild(bGo);
        const bDiag = el('button', 'menu_button cmcc-mini', '诊断信息');
        bDiag.title = '复制当前状态，便于排查问题';
        bDiag.onclick = async () => {
            const txt = JSON.stringify(collectDiagnostics(ctx, api), null, 2);
            console.log(LOG_TAG, '诊断', txt);
            try { await navigator.clipboard.writeText(txt); ctx.toastr?.success?.('诊断信息已复制'); }
            catch (e) { ctx.toastr?.info?.('诊断信息已打印到控制台（F12）'); }
        };
        tools0.appendChild(bDiag);
        body.appendChild(tools0);
        return;
    }

    // 记忆是否真的能被她读到？
    //   注入开  → 直接进提示词，**不需要**挂世界书
    //   注入关  → 只能靠世界书，必须挂载
    const injectionOn = snap.injectMemory !== false;
    const bookActive = isWorldBookActive(ctx, snap.bookName);
    if (snap.stats.totalEntries > 0 && !injectionOn && !bookActive) {
        const warnBox = el('div', 'cmcc-top-section cmcc-warn');
        warnBox.innerHTML = '<b>⚠ 记忆可能读不到</b><br>'
            + '<span style="opacity:.85">你关掉了「注入记忆」，所以只能靠世界书。'
            + '请把 <code>' + snap.bookName + '</code> 勾成<b>全局世界书</b>'
            + '（或挂到当前聊天），否则 AI 看不到记忆。</span><br>'
            + '<span style="opacity:.7">或者打开「注入记忆」，就不需要挂世界书了。</span>';
        const bFix = el('button', 'menu_button cmcc-mini', '去挂载');
        bFix.onclick = () => {
            try {
                const icon = document.querySelector('#WI-SP-button .drawer-toggle');
                if (icon && !document.getElementById('WorldInfo')?.classList.contains('openDrawer')) {
                    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }
                ctx.toastr?.info?.('在列表里找到「' + snap.bookName + '」，勾上左侧的全局标记');
            } catch (e) { ctx.toastr?.info?.('请手动打开世界书面板勾选'); }
        };
        warnBox.appendChild(bFix);
        body.appendChild(warnBox);
    } else if (snap.stats.totalEntries > 0 && injectionOn) {
        // 注入模式：给个安心提示（很多用户会以为还得挂世界书）
        const okBox = el('div', 'cmcc-top-section cmcc-ok');
        okBox.innerHTML = '<b>✓ 记忆已直接注入</b> '
            + '<span style="opacity:.8">不需要挂载世界书。'
            + (bookActive ? '（世界书也已挂载，双保险）' : '')
            + '</span>';
        body.appendChild(okBox);
    }

    // ── 人设（可直接改）──
    //   内置模式 → 改的是扩展设置里的内置人设（不碰角色卡库）
    //   角色卡模式 → 改的是角色卡本身
    const personaBox = el('div', 'cmcc-top-section');
    const ph = el('div', 'cmcc-top-sec-head');
    ph.innerHTML = `<b>人设</b><span class="cmcc-meta">${isBuiltin ? '内置' : '角色卡'}</span>`;
    const reloadP = el('button', 'cmcc-x', '⟳');
    reloadP.title = '刷新';
    reloadP.onclick = () => renderTopPanel({ ctx, api, onGotoSettings });
    ph.appendChild(reloadP);
    personaBox.appendChild(ph);

    const d = isBuiltin ? (snap.builtin || {}) : (comp?.data || {});
    const fields = isBuiltin
        ? [
            ['name', '名字', d.name || ''],
            ['description', '角色描述', d.description || ''],
            ['personality', '性格', d.personality || ''],
            ['scenario', '与你的关系', d.scenario || ''],
        ]
        : [
            ['description', '角色描述', d.description || ''],
            ['personality', '性格', d.personality || ''],
            ['scenario', '场景', d.scenario || ''],
            ['first_mes', '开场白', d.first_mes || ''],
        ];
    for (const [key, label, val] of fields) {
        const row = el('div', 'cmcc-field');
        const lab = el('label', 'cmcc-field-label', label);
        lab.title = isBuiltin
            ? '点击编辑（存进扩展设置，不碰角色卡）'
            : '点击编辑（会直接改角色卡，记得在角色管理里保存）';
        row.appendChild(lab);
        const txt = el('div', 'cmcc-field-val',
            (val || '（空）').slice(0, 160) + (val && val.length > 160 ? ' …' : ''));
        txt.onclick = async () => {
            const v = await ctx.callGenericPopup(
                `编辑「${label}」：`, ctx.POPUP_TYPE.INPUT, val);
            if (v != null && v !== val) {
                await api.editPersona(key, v);
                renderTopPanel({ ctx, api, onGotoSettings });
            }
        };
        row.appendChild(txt);
        personaBox.appendChild(row);
    }
    body.appendChild(personaBox);

    // ── 记忆 ──
    const memBox = el('div', 'cmcc-top-section');
    const mh = el('div', 'cmcc-top-sec-head');
    mh.innerHTML = `<b>记忆</b>`
        + `<span class="cmcc-meta">${snap.stats.worldCount} 个世界 · `
        + `${snap.stats.totalEntries} 条记忆</span>`;
    mh.title = '一个「存档」= 一个聊天记录；一条记忆 = 一件事';
    const reloadM = el('button', 'cmcc-x', '⟳');
    mh.appendChild(reloadM);
    reloadM.title = '从世界书重新载入';
    reloadM.onclick = async () => { await api.reload(); renderTopPanel({ ctx, api, onGotoSettings }); };
    memBox.appendChild(mh);

    // 当前位置
    let cur = { wKey: '', sKey: '', wLabel: '' };
    try { cur = api.currentPos(); } catch (e) { /* ignore */ }

    // ── 多选工具栏 ──
    const selBar = el('div', 'cmcc-selbar');
    const bSelToggle = el('button', 'menu_button cmcc-mini',
        SELECT_MODE ? '✕ 退出多选' : '☑ 多选');
    bSelToggle.title = SELECT_MODE ? '退出多选模式' : '勾选多条记忆一起删';
    bSelToggle.onclick = () => {
        SELECT_MODE = !SELECT_MODE;
        if (!SELECT_MODE) { SELECTED.clear(); SELECTED_SAVES.clear(); SELECTED_WORLDS.clear(); }
        renderTopPanel({ ctx, api, onGotoSettings });
    };
    selBar.appendChild(bSelToggle);

    if (SELECT_MODE) {
        const wN = SELECTED_WORLDS.size;
        const sN = SELECTED_SAVES.size;
        selBar.appendChild(el('span', 'cmcc-meta',
            `已选 ${SELECTED.size} 条`
            + (sN ? ` + ${sN} 个存档` : '')
            + (wN ? ` + ${wN} 个世界` : '')));

        const bAll = el('button', 'menu_button cmcc-mini', '全选当前');
        bAll.title = '勾选当前世界里的全部记忆';
        bAll.onclick = () => {
            for (const w of snap.stats.worlds) {
                for (const s of w.saves) {
                    const arr = snap.worlds?.[w.key]?.saves?.[s.key]?.entries || [];
                    arr.forEach((_, i) => SELECTED.add(entryKey(w.key, s.key, i)));
                }
            }
            renderTopPanel({ ctx, api, onGotoSettings });
        };
        selBar.appendChild(bAll);

        const bNone = el('button', 'menu_button cmcc-mini', '清空勾选');
        bNone.onclick = () => {
            SELECTED.clear();
            SELECTED_SAVES.clear();
            SELECTED_WORLDS.clear();
            renderTopPanel({ ctx, api, onGotoSettings });
        };
        selBar.appendChild(bNone);

        const totalSel = SELECTED.size + SELECTED_SAVES.size + SELECTED_WORLDS.size;
        const bDel = el('button', 'menu_button cmcc-mini cmcc-danger',
            (sN || wN) ? `删除选中的 ${totalSel} 项` : `删除选中的 ${SELECTED.size} 条`);
        bDel.disabled = totalSel === 0;
        bDel.onclick = async () => {
            if (!totalSel) return;
            const desc = [
                SELECTED.size ? `${SELECTED.size} 条记忆` : '',
                sN ? `${sN} 个存档（含其全部记忆）` : '',
                wN ? `${wN} 个世界（含其全部存档）` : '',
            ].filter(Boolean).join(' + ');
            const ok = await ctx.callGenericPopup(
                `确定删除 ${desc}？此操作不可撤销。`, ctx.POPUP_TYPE.CONFIRM);
            if (!ok) return;

            let total = 0;
            // ① 先删勾选的整个世界
            const deadWorlds = new Set(SELECTED_WORLDS);
            for (const wk of deadWorlds) {
                const r = await api.deleteByScope('currentWorld', wk);
                total += r.deleted;
            }
            // ② 再删勾选的整个存档（跳过已被删世界里的）
            const deadSaves = new Set();
            for (const k of SELECTED_SAVES) {
                const [w, sk] = k.split('\u0000');
                if (deadWorlds.has(w)) continue;
                deadSaves.add(k);
                const r = await api.deleteByScope('save', w, sk);
                total += r.deleted;
            }
            // ③ 最后删勾选的零散记忆（跳过已删的世界/存档）
            const groups = new Map();
            for (const k of SELECTED) {
                const [w, s, i] = parseEntryKey(k);
                if (deadWorlds.has(w)) continue;
                if (deadSaves.has(w + '\u0000' + s)) continue;
                const gk = w + '\u0000' + s;
                if (!groups.has(gk)) groups.set(gk, { w, s, idx: [] });
                groups.get(gk).idx.push(i);
            }
            for (const { w, s, idx } of groups.values()) {
                total += await api.deleteMemories(w, s, idx);
            }

            const extra = [
                deadSaves.size ? `${deadSaves.size} 个存档` : '',
                deadWorlds.size ? `${deadWorlds.size} 个世界` : '',
            ].filter(Boolean).join(' + ');
            SELECTED.clear();
            SELECTED_SAVES.clear();
            SELECTED_WORLDS.clear();
            ctx.toastr?.success?.(
                `已删除 ${total} 条记忆` + (extra ? `（含 ${extra}）` : ''));
            renderTopPanel({ ctx, api, onGotoSettings });
        };
        selBar.appendChild(bDel);
    }
    memBox.appendChild(selBar);

    /**
     * 渲染一组记忆条目（可编辑 / 删除）
     * 抽成函数是因为「存档记忆」和「世界级记忆」要共用同一套交互。
     */
    function renderEntries(wKey, sKey, entries) {
        const ul = el('div', 'cmcc-entries');
        const SHOW = 30;
        const start = Math.max(0, (entries || []).length - SHOW);
        (entries || []).slice(start).forEach((e, i) => {
            const idx = start + i;
            const row = el('div', 'cmcc-entry');
            row.appendChild(el('span', 'cmcc-lv cmcc-lv3', 'L3'));

            if (SELECT_MODE) {
                // ── 多选模式：显示勾选框，点整行即勾选 ──
                const val = entryKey(wKey, sKey, idx);
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'cmcc-check';
                cb.checked = SELECTED.has(val);
                cb.onclick = (ev) => ev.stopPropagation();
                cb.onchange = () => {
                    if (cb.checked) SELECTED.add(val);
                    else SELECTED.delete(val);
                    renderTopPanel({ ctx, api, onGotoSettings });
                };
                row.appendChild(cb);
                row.classList.add('cmcc-entry-sel');
                if (SELECTED.has(val)) row.classList.add('cmcc-picked');
                const t2 = el('span', 'cmcc-entry-text', e.text);
                row.appendChild(t2);
                // 点整行 = 切换这一条（L3 没有再下层，不需要级联）
                row.onclick = () => {
                    if (SELECTED.has(val)) SELECTED.delete(val);
                    else SELECTED.add(val);
                    renderTopPanel({ ctx, api, onGotoSettings });
                };
                ul.appendChild(row);
                return;
            }

            const txt = el('span', 'cmcc-entry-text', e.text);
            txt.title = '点击编辑';
            txt.onclick = async () => {
                const v = await ctx.callGenericPopup('修改这条记忆：', ctx.POPUP_TYPE.INPUT, e.text);
                if (v != null && v !== '') {
                    await api.editMemory(wKey, sKey, idx, v);
                    renderTopPanel({ ctx, api, onGotoSettings });
                }
            };
            row.appendChild(txt);
            const x = el('button', 'cmcc-x', '×');
            x.title = '删除这条';
            x.onclick = async () => {
                await api.deleteMemory(wKey, sKey, idx);
                renderTopPanel({ ctx, api, onGotoSettings });
            };
            row.appendChild(x);
            ul.appendChild(row);
        });
        if (!(entries || []).length) ul.appendChild(el('div', 'cmcc-empty', '（暂无）'));
        if ((entries || []).length > SHOW) {
            ul.appendChild(el('div', 'cmcc-more',
                `… 还有 ${entries.length - SHOW} 条更早的（可用下面按钮到世界书里看）`));
        }
        return ul;
    }

    /** 「+ 加一条」按钮（存档记忆与世界级记忆共用） */
    function makeAddRow(wKey, sKey, prompt) {
        const addRow = el('div', 'cmcc-add');
        const addBtn = el('button', 'menu_button cmcc-mini', '+ 加一条');
        addBtn.onclick = async () => {
            const v = await ctx.callGenericPopup(prompt || '新增一条记忆：', ctx.POPUP_TYPE.INPUT, '');
            if (v) {
                await api.addMemory(wKey, sKey, v);
                renderTopPanel({ ctx, api, onGotoSettings });
            }
        };
        addRow.appendChild(addBtn);
        return addRow;
    }

    memBox.appendChild(el('div', 'cmcc-now',
        `当前位置：<b>${cur.wLabel || '—'}</b>`));

    if (!snap.stats.worlds.length) {
        memBox.appendChild(el('div', 'cmcc-empty', '还没有记忆，去玩一张卡就会开始记录。'));
    }

    for (const w of snap.stats.worlds.slice(0, 10)) {
        const card = el('div', 'cmcc-world' + (w.key === cur.wKey ? ' cmcc-cur' : ''));
        const wKeyId = 'w:' + w.key;
        const wCollapsed = COLLAPSED.has(wKeyId);

        const wh = el('div', 'cmcc-world-head');
        const wchev = el('span', 'cmcc-chev', wCollapsed ? '▸' : '▾');
        wh.appendChild(wchev);
        // 多选模式下，整个世界可以被勾选
        if (SELECT_MODE) {
            const wcb = document.createElement('input');
            wcb.type = 'checkbox';
            wcb.className = 'cmcc-check cmcc-world-check';
            const wState = worldSelState(w.key, snap.worlds);
            wcb.checked = wState === 'all';
            wcb.indeterminate = wState === 'some';   // 半选：部分勾上
            wcb.title = '勾选整个世界（连同它下面所有存档与记忆）';
            wcb.onclick = (ev) => ev.stopPropagation();
            wcb.onchange = () => {
                // ★ 级联：勾世界 = 把它下面所有存档和记忆一起勾上
                if (wcb.checked) SELECTED_WORLDS.add(w.key);
                else SELECTED_WORLDS.delete(w.key);
                setWorldAll(w.key, wcb.checked, snap.worlds);
                renderTopPanel({ ctx, api, onGotoSettings });
            };
            wh.appendChild(wcb);
            if (SELECTED_WORLDS.has(w.key)) card.classList.add('cmcc-picked');
        }
        // L1 = 世界
        wh.appendChild(el('span', 'cmcc-lv cmcc-lv1', 'L1'));
        wh.appendChild(el('span', 'cmcc-lvname', '世界'));
        const wt = el('span', 'cmcc-world-title',
            (w.key === cur.wKey ? '● ' : '') + w.label);
        wt.title = '点击改名';
        wt.onclick = async (ev) => {
            ev.stopPropagation();
            const v = await ctx.callGenericPopup('重命名这个世界：', ctx.POPUP_TYPE.INPUT, w.label);
            if (v) { await api.renameWorld(w.key, v); renderTopPanel({ ctx, api, onGotoSettings }); }
        };
        wh.appendChild(wt);
        // 一个「存档」= 一个聊天记录（不是一次生成）；「条」= 一条记忆
        wh.appendChild(el('span', 'cmcc-meta',
            `${w.saveCount} 个存档 · ${w.count} 条记忆`));
        wh.appendChild(el('span', 'cmcc-curbadge',
            w.key === cur.wKey ? '当前位置' : ''));
        // 点标题行任意处折叠/展开
        wh.onclick = () => { toggleCollapsed(wKeyId); renderTopPanel({ ctx, api, onGotoSettings }); };
        wh.title = '点击展开 / 收起';
        card.appendChild(wh);

        if (wCollapsed) {
            memBox.appendChild(card);   // 收起：只留标题行
            continue;
        }

        // ⚠ v0.9.2：取消了「世界级记忆」（world 范围）。
        //   它渲染出来像一个伪存档，让三级看起来是混的；
        //   而且设计上：她该记的是「和你一起经历的事」，不是世界设定。
        //   旧的 world 记忆会在启动时迁进各世界的第一个存档。

        for (const s of w.saves) {
            const sKeyId = 's:' + w.key + '|' + s.key;
            const sCollapsed = COLLAPSED.has(sKeyId);
            const sd = el('div', 'cmcc-save');
            const sh = el('div', 'cmcc-save-head');
            sh.appendChild(el('span', 'cmcc-chev', sCollapsed ? '▸' : '▾'));
            // 多选模式下，整个存档可以被勾选
            if (SELECT_MODE) {
                const scb = document.createElement('input');
                scb.type = 'checkbox';
                scb.className = 'cmcc-check cmcc-save-check';
                const sState = saveSelState(w.key, s.key, snap.worlds);
                scb.checked = sState === 'all';
                scb.indeterminate = sState === 'some';   // 半选：部分勾上
                scb.title = '勾选这个存档（连同它下面全部记忆）';
                scb.onclick = (ev) => ev.stopPropagation();
                scb.onchange = () => {
                    // ★ 级联：勾存档 = 把它下面所有记忆一起勾上
                    if (scb.checked) SELECTED_SAVES.add(sKeyId);
                    else SELECTED_SAVES.delete(sKeyId);
                    setSaveEntries(w.key, s.key, scb.checked, snap.worlds);
                    renderTopPanel({ ctx, api, onGotoSettings });
                };
                sh.appendChild(scb);
            }
            sh.appendChild(el('span', 'cmcc-lv cmcc-lv2', 'L2'));
            sh.appendChild(el('span', 'cmcc-lvname', '存档'));
            const st = el('span', 'cmcc-save-title', s.label);
            st.title = '点击改名';
            st.onclick = async (ev) => {
                ev.stopPropagation();
                const v = await ctx.callGenericPopup('重命名这次经历：', ctx.POPUP_TYPE.INPUT, s.label);
                if (v) { await api.renameSave(w.key, s.key, v); renderTopPanel({ ctx, api, onGotoSettings }); }
            };
            sh.appendChild(st);
            sh.appendChild(el('span', 'cmcc-meta', `${s.count} 条记忆`));
            if (s.key === cur.sKey && w.key === cur.wKey) {
                sh.appendChild(el('span', 'cmcc-curbadge', '当前位置'));
            }
            const del = el('button', 'cmcc-x', '×');
            del.title = '删除这个存档的全部记忆';
            del.onclick = async (ev) => {
                ev.stopPropagation();
                const ok = await ctx.callGenericPopup(
                    `确定删除「${w.label} / ${s.label}」的全部记忆？`, ctx.POPUP_TYPE.CONFIRM);
                if (ok) { await api.deleteSave(w.key, s.key); renderTopPanel({ ctx, api, onGotoSettings }); }
            };
            sh.appendChild(del);
            sh.onclick = () => { toggleCollapsed(sKeyId); renderTopPanel({ ctx, api, onGotoSettings }); };
            sh.title = '点击展开 / 收起';
            if (SELECT_MODE && SELECTED_SAVES.has(sKeyId)) sd.classList.add('cmcc-picked');
            sd.appendChild(sh);

            if (!sCollapsed) {
                const entries = snap.worlds?.[w.key]?.saves?.[s.key]?.entries || [];
                sd.appendChild(renderEntries(w.key, s.key, entries));
                sd.appendChild(makeAddRow(w.key, s.key, '新增一条记忆：'));
            }

            card.appendChild(sd);
        }
        memBox.appendChild(card);
    }
    body.appendChild(memBox);

    // ── 底部工具 ──
    const tools = el('div', 'cmcc-btns');
    const mk = (label, fn, title) => {
        const b = el('button', 'menu_button cmcc-mini', label);
        if (title) b.title = title;
        b.onclick = fn;
        return b;
    };
    tools.appendChild(mk('整理记忆', () => api.summarize(true), '立刻整理一次'));
    tools.appendChild(mk('全部展开', () => {
        COLLAPSED.clear();
        renderTopPanel({ ctx, api, onGotoSettings });
    }, '展开所有世界与存档'));
    tools.appendChild(mk('全部收起', () => {
        for (const w of snap.stats.worlds) {
            COLLAPSED.add('w:' + w.key);
            for (const s of w.saves) COLLAPSED.add('s:' + w.key + '|' + s.key);
        }
        renderTopPanel({ ctx, api, onGotoSettings });
    }, '收起所有世界与存档'));
    tools.appendChild(mk('只看当前', () => {
        COLLAPSED.clear();
        for (const w of snap.stats.worlds) {
            if (w.key !== cur.wKey) COLLAPSED.add('w:' + w.key);
            for (const s of w.saves) {
                if (w.key !== cur.wKey || s.key !== cur.sKey) {
                    COLLAPSED.add('s:' + w.key + '|' + s.key);
                }
            }
        }
        renderTopPanel({ ctx, api, onGotoSettings });
    }, '只展开当前世界与当前存档'));
    tools.appendChild(mk('打开世界书', () => {
        openWorldBook(ctx, snap.bookName);
    }, '打开酒馆的世界书面板并定位到记忆世界书'));
    body.appendChild(tools);

    // ── 按范围删除 ──
    const dangerBox = el('div', 'cmcc-top-section cmcc-danger-box');
    dangerBox.appendChild(el('div', 'cmcc-sec-title', '按范围删除'));

    const mkScope = (label, scope, what) => {
        const b = el('button', 'menu_button cmcc-mini cmcc-danger', label);
        b.title = '删除：' + what;
        b.onclick = async () => {
            const ok = await ctx.callGenericPopup(
                `确定删除「${what}」的**全部**记忆？此操作不可撤销。`,
                ctx.POPUP_TYPE.CONFIRM);
            if (!ok) return;
            const r = await api.deleteByScope(scope);
            SELECTED.clear();
            ctx.toastr?.success?.(`已删除 ${r.deleted} 条（${r.what}）`);
            renderTopPanel({ ctx, api, onGotoSettings });
        };
        return b;
    };

    // ⚠ 这里原来还有一个「清空世界级」按钮（scope='world'）。
    //   world 范围在 v0.9.2 就取消了，那个按钮点了**什么都不会发生** ——
    //   用户报的「最底部的红色删除没用」就是它。已删除。
    const scopeRow1 = el('div', 'cmcc-btns');
    scopeRow1.appendChild(mkScope('清空本次存档', 'save',
        `${cur.wLabel || '当前世界'} / 本次`));
    const scopeRow2 = el('div', 'cmcc-btns');
    scopeRow2.appendChild(mkScope('清空共同记忆', 'shared', '跨所有世界的共同记忆'));
    scopeRow2.appendChild(mkScope('删除整个世界', 'currentWorld',
        `${cur.wLabel || '当前世界'}（含全部存档）`));
    dangerBox.appendChild(scopeRow1);
    dangerBox.appendChild(scopeRow2);

    dangerBox.appendChild(el('div', 'cmcc-hint',
        '这些只删记忆，不会删你的聊天记录。删错了可以用 ST 的世界书编辑器手动补回来。'));
    body.appendChild(dangerBox);
}

/**
 * 打开 ST 的世界书面板并定位到指定世界书
 *
 * 为什么不直接调 openWorldInfoEditor：
 *   它是 world-info.js 的 export，**不在 getContext() 里**，
 *   ctx.openWorldInfoEditor 永远是 undefined（这是曾经的 bug，按钮点了没反应）。
 *   所以照它内部的做法手动来：
 *     ① 点 #WIDrawerIcon 打开抽屉（ST 的 drawer-toggle 是静态绑定，点它有效）
 *     ② 给 #world_editor_select 补上选项、选中目标、触发 change
 */
export function openWorldBook(ctx, bookName) {
    const name = bookName || 'CMCC-记忆库';

    // ① 打开抽屉
    const panel = document.getElementById('WorldInfo');
    const opened = panel?.classList.contains('openDrawer');
    if (!opened) {
        const icon = document.getElementById('WIDrawerIcon')
            || document.querySelector('#WI-SP-button .drawer-toggle');
        if (!icon) {
            ctx.toastr?.warning?.('找不到世界书面板，请用顶部的世界书图标手动打开');
            return false;
        }
        icon.click();
    }

    // ② 选中目标世界书（抽屉内容可能是异步渲染的，等一小会儿）
    const pick = () => {
        const sel = document.getElementById('world_editor_select');
        if (!sel) return false;
        // 选项可能还没建，用 world_names 补齐
        let names = [];
        try { names = ctx.world_names || []; } catch (e) { /* ignore */ }
        for (const n of names) {
            if (![...sel.options].some((o) => o.value === n)) {
                const o = document.createElement('option');
                o.value = n;
                o.textContent = n;
                sel.appendChild(o);
            }
        }
        if (![...sel.options].some((o) => o.value === name)) {
            ctx.toastr?.warning?.(`世界书「${name}」还没创建（写进第一条记忆后会自动建）`);
            return false;
        }
        sel.value = name;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    };

    if (!pick()) {
        setTimeout(() => {
            if (!pick()) {
                ctx.toastr?.info?.(`请在列表里选「${name}」`);
            }
        }, 400);
    }
    return true;
}
