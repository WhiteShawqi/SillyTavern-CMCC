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

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}

/** 建抽屉骨架（只建一次） */
export function mountTopDrawer() {
    if (document.getElementById(DRAWER_ID)) return;

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
        if (isTopPanelOpen()) closeDrawer();
        else openTopPanel();
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
        if (drawer.contains(t)) return;
        // 点其他顶部图标时不抢（让 ST 自己处理）
        if (t?.closest?.('#top-settings-holder')) closeDrawer();
    });
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
    const body = document.getElementById(PANEL_ID + '_body');
    if (!body) return;
    body.innerHTML = '';

    let snap;
    try { snap = api.snapshot(); } catch (e) {
        body.appendChild(el('div', 'cmcc-empty', '读取失败，看控制台'));
        return;
    }

    const comp = (ctx.characters || []).find((c) => c && c.avatar === snap.companionAvatar);
    const compName = comp?.name || '（未选择陪伴角色）';

    // ── 当前陪伴者 ──
    const who = el('div', 'cmcc-top-who');
    who.innerHTML = `<span class="cmcc-top-who-label">当前陪伴者</span>`
        + `<span class="cmcc-top-who-name">${compName}</span>`;
    const switchBtn = el('button', 'menu_button cmcc-mini', '切换 →');
    switchBtn.title = '到扩展设置页切换（和酒馆助手同位置）';
    switchBtn.onclick = () => { closeDrawer(); onGotoSettings(); };
    who.appendChild(switchBtn);
    body.appendChild(who);

    if (!snap.companionAvatar) {
        body.appendChild(el('div', 'cmcc-empty',
            '还没有选择陪伴角色。点上面「切换 →」到扩展设置里选一张卡。'));
        return;
    }

    // ── 人设（可直接改，改的是卡本身）──
    const personaBox = el('div', 'cmcc-top-section');
    const ph = el('div', 'cmcc-top-sec-head');
    ph.innerHTML = '<b>人设</b>';
    const reloadP = el('button', 'cmcc-x', '⟳');
    reloadP.title = '刷新';
    reloadP.onclick = () => renderTopPanel({ ctx, api, onGotoSettings });
    ph.appendChild(reloadP);
    personaBox.appendChild(ph);

    const d = comp?.data || {};
    const fields = [
        ['description', '角色描述', d.description || ''],
        ['personality', '性格', d.personality || ''],
        ['scenario', '场景', d.scenario || ''],
        ['first_mes', '开场白', d.first_mes || ''],
    ];
    for (const [key, label, val] of fields) {
        const row = el('div', 'cmcc-field');
        const lab = el('label', 'cmcc-field-label', label);
        lab.title = '点击编辑（会直接改角色卡，记得在角色管理里保存）';
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
            const ul = el('div', 'cmcc-entries');
            const SHOW = 30;
            const start = Math.max(0, entries.length - SHOW);
            entries.slice(start).forEach((e, i) => {
                const idx = start + i;
                const row = el('div', 'cmcc-entry');
                const txt = el('span', 'cmcc-entry-text', e.text);
                txt.title = '点击编辑';
                txt.onclick = async () => {
                    const v = await ctx.callGenericPopup('修改这条记忆：', ctx.POPUP_TYPE.INPUT, e.text);
                    if (v != null && v !== '') {
                        await api.editMemory(w.key, s.key, idx, v);
                        renderTopPanel({ ctx, api, onGotoSettings });
                    }
                };
                row.appendChild(txt);
                const x = el('button', 'cmcc-x', '×');
                x.onclick = async () => {
                    await api.deleteMemory(w.key, s.key, idx);
                    renderTopPanel({ ctx, api, onGotoSettings });
                };
                row.appendChild(x);
                ul.appendChild(row);
            });
            if (!entries.length) ul.appendChild(el('div', 'cmcc-empty', '（暂无）'));
            if (entries.length > SHOW) {
                ul.appendChild(el('div', 'cmcc-more',
                    `… 还有 ${entries.length - SHOW} 条更早的（可用下面按钮到世界书里看）`));
            }
            sd.appendChild(ul);

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
