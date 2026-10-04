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

import { WORLDBOOK_CHANNEL } from './inject.js';

const DRAWER_ID = 'cmcc-top-drawer';
const PANEL_ID = 'cmcc-top-panel';
const LOG_TAG = '[CMCC]';

/** 重渲染钩子：由 index.js 注册（避免 topbar 反向依赖 index） */
let RENDER_HOOK = null;
export function setRenderHook(fn) { RENDER_HOOK = fn; }

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
        if (drawer.contains(t)) return;          // 点自己面板：不关
        if (t?.closest?.('#' + DRAWER_ID)) return;
        closeDrawer();                            // 点任何其它地方都收起
    });
    // Esc 也能收起
    document.addEventListener('keydown', (ev) => {
        if (!isTopPanelOpen()) return;
        if (ev.key === 'Escape') closeDrawer();
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

/** 关闭时清掉可能残留的 popper 状态 */
document.addEventListener('click', (e) => {
    // 点面板外部不自动关（跟 ST 其他抽屉一致，需要手动关）
}, true);

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
    mh.innerHTML = `<b>记忆</b><span class="cmcc-meta">${snap.stats.worldCount} 个世界 / ${snap.stats.totalEntries} 条</span>`;
    const reloadM = el('button', 'cmcc-x', '⟳');
    mh.appendChild(reloadM);
    reloadM.title = '从世界书重新载入';
    reloadM.onclick = async () => { await api.reload(); renderTopPanel({ ctx, api, onGotoSettings }); };
    memBox.appendChild(mh);

    // 当前位置
    let cur = { wKey: '', sKey: '', wLabel: '' };
    try { cur = api.currentPos(); } catch (e) { /* ignore */ }

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

    memBox.appendChild(el('div', 'cmcc-now',
        `当前位置：<b>${cur.wLabel || '—'}</b>`));

    if (!snap.stats.worlds.length) {
        memBox.appendChild(el('div', 'cmcc-empty', '还没有记忆，去玩一张卡就会开始记录。'));
    }

    for (const w of snap.stats.worlds.slice(0, 10)) {
        const card = el('div', 'cmcc-world' + (w.key === cur.wKey ? ' cmcc-cur' : ''));

        const wh = el('div', 'cmcc-world-head');
        const wt = el('span', 'cmcc-world-title', (w.key === cur.wKey ? '▶ ' : '') + w.label);
        wt.title = '点击改名';
        wt.onclick = async () => {
            const v = await ctx.callGenericPopup('重命名这个世界：', ctx.POPUP_TYPE.INPUT, w.label);
            if (v) { await api.renameWorld(w.key, v); renderTopPanel({ ctx, api, onGotoSettings }); }
        };
        wh.appendChild(wt);
        wh.appendChild(el('span', 'cmcc-meta', `${w.saveCount} 次 / ${w.count} 条`));
        card.appendChild(wh);

        // ── 世界级记忆（整个世界通用，换存档也记得）──
        // 它们存在 __world__ 通道里，不是一个「存档」，要单独展示，
        // 否则用户既看不到也改不了（曾经的 bug）。
        if (w.worldEntryCount) {
            const wsd = el('div', 'cmcc-save cmcc-save-world');
            const wsh = el('div', 'cmcc-save-head');
            const wst = el('span', 'cmcc-save-title', '· 整个世界都成立');
            wst.title = '换哪一次存档都记得的事（world 范围）';
            wsh.appendChild(wst);
            wsh.appendChild(el('span', 'cmcc-meta', `${w.worldEntryCount} 条`));
            wsd.appendChild(wsh);
            wsd.appendChild(renderEntries(w.key, WORLDBOOK_CHANNEL,
                snap.worlds?.[w.key]?.saves?.[WORLDBOOK_CHANNEL]?.entries || []));
            card.appendChild(wsd);
        }

        for (const s of w.saves) {
            const sd = el('div', 'cmcc-save');
            const sh = el('div', 'cmcc-save-head');
            const st = el('span', 'cmcc-save-title', s.label);
            st.title = '点击改名';
            st.onclick = async () => {
                const v = await ctx.callGenericPopup('重命名这次经历：', ctx.POPUP_TYPE.INPUT, s.label);
                if (v) { await api.renameSave(w.key, s.key, v); renderTopPanel({ ctx, api, onGotoSettings }); }
            };
            sh.appendChild(st);
            sh.appendChild(el('span', 'cmcc-meta', `${s.count} 条`));
            const del = el('button', 'cmcc-x', '×');
            del.title = '删除这次经历的全部记忆';
            del.onclick = async () => {
                const ok = await ctx.callGenericPopup(
                    `确定删除「${w.label} / ${s.label}」的全部记忆？`, ctx.POPUP_TYPE.CONFIRM);
                if (ok) { await api.deleteSave(w.key, s.key); renderTopPanel({ ctx, api, onGotoSettings }); }
            };
            sh.appendChild(del);
            sd.appendChild(sh);

            const entries = snap.worlds?.[w.key]?.saves?.[s.key]?.entries || [];
            sd.appendChild(renderEntries(w.key, s.key, entries));

            const addRow = el('div', 'cmcc-add');
            const addBtn = el('button', 'menu_button cmcc-mini', '+ 加一条');
            addBtn.onclick = async () => {
                const v = await ctx.callGenericPopup('新增一条记忆：', ctx.POPUP_TYPE.INPUT, '');
                if (v) { await api.addMemory(w.key, s.key, v); renderTopPanel({ ctx, api, onGotoSettings }); }
            };
            addRow.appendChild(addBtn);
            sd.appendChild(addRow);

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
    tools.appendChild(mk('打开世界书', () => {
        try {
            if (typeof ctx.openWorldInfoEditor === 'function') ctx.openWorldInfoEditor('CMCC-记忆库');
            else ctx.toastr?.info?.('请在世界书列表里打开「CMCC-记忆库」');
        } catch (e) { ctx.toastr?.info?.('请在世界书列表里打开「CMCC-记忆库」'); }
    }, '用 ST 的编辑器批量改记忆'));
    body.appendChild(tools);
}
