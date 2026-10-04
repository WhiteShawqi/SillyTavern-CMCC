/**
 * CMCC · 设置面板
 * 支持：编辑单条记忆、新增、删除、重命名存档、重命名世界
 */

const ID = 'cmcc_root';

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}

/**
 * @param {object} o
 * @param {object} o.settings
 * @param {() => void} o.onSave
 * @param {object} o.ctx
 * @param {object} o.api  index.js 暴露的操作
 */
export function renderPanel(o) {
    const { settings, onSave, ctx, api } = o;
    document.getElementById(ID)?.remove();

    const root = el('div', 'cmcc-panel');
    root.id = ID;

    // ── 标题 ──
    const head = el('div', 'cmcc-head');
    head.innerHTML = '<b>跨世界陪伴角色</b>'
        + '<span class="cmcc-sub">一个固定的角色，记得你们经历的一切</span>';
    const toggle = el('label', 'cmcc-switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!settings.enabled;
    cb.onchange = () => {
        settings.enabled = cb.checked;
        onSave();
        if (cb.checked) api.reload();
    };
    toggle.appendChild(cb);
    toggle.appendChild(el('span', null, '启用'));
    head.appendChild(toggle);
    root.appendChild(head);

    // ── 选角色卡 ──
    const row1 = el('div', 'cmcc-row');
    row1.appendChild(el('label', 'cmcc-label', '陪伴角色卡'));
    const sel = document.createElement('select');
    sel.className = 'text_pole cmcc-select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '—— 未选择 ——';
    sel.appendChild(none);
    (ctx.characters || []).forEach((c, i) => {
        if (!c) return;
        const opt = document.createElement('option');
        opt.value = c.avatar || String(i);
        opt.textContent = c.name || '(无名)';
        sel.appendChild(opt);
    });
    sel.value = settings.companionAvatar || '';
    sel.onchange = async () => {
        await api.setCompanion(sel.value);
    };
    row1.appendChild(sel);
    root.appendChild(row1);

    // ── 打开记忆世界书 ──
    const bar = el('div', 'cmcc-row cmcc-bar');
    const btnOpen = el('button', 'menu_button', '打开记忆世界书');
    btnOpen.title = '用 ST 自带的编辑器改（改完点上面的"重新载入"）';
    btnOpen.onclick = () => {
        try {
            const ev = new Event('click');
            const btn = document.getElementById('world_info');
            if (typeof ctx.openWorldInfoEditor === 'function') {
                ctx.openWorldInfoEditor('CMCC-记忆库');
            } else {
                document.getElementById('WIDrawerIcon')?.dispatchEvent(ev);
                ctx.toastr?.info?.('请在世界书列表里手动打开「CMCC-记忆库」');
            }
        } catch (e) {
            ctx.toastr?.info?.('请在世界书列表里手动打开「CMCC-记忆库」');
        }
    };
    bar.appendChild(btnOpen);
    const btnReload = el('button', 'menu_button', '重新载入');
    btnReload.onclick = () => api.reload();
    bar.appendChild(btnReload);
    root.appendChild(bar);

    // ── 选项 ──
    const opts = el('div', 'cmcc-opts');
    const mkCheck = (label, key, title) => {
        const l = el('label', 'cmcc-chk');
        if (title) l.title = title;
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.checked = !!settings[key];
        i.onchange = () => { settings[key] = i.checked; onSave(); };
        l.appendChild(i);
        l.appendChild(el('span', null, label));
        return l;
    };
    opts.appendChild(mkCheck('存档切换提示', 'announceSaveSwitch',
        '换世界/换存档时，让她自然表现出"这是另一次经历"'));
    opts.appendChild(mkCheck('调试输出', 'debug', '把注入内容打到浏览器控制台 F12'));
    root.appendChild(opts);

    // ── 数值 ──
    const row2 = el('div', 'cmcc-row');
    const mkNum = (label, key, min, max, title) => {
        const wrap = el('div', 'cmcc-num');
        const lb = el('label', 'cmcc-label', label);
        if (title) lb.title = title;
        wrap.appendChild(lb);
        const i = document.createElement('input');
        i.type = 'number'; i.className = 'text_pole'; i.min = min; i.max = max;
        i.value = settings[key];
        i.onchange = () => {
            const v = parseInt(i.value, 10);
            if (!Number.isNaN(v)) { settings[key] = Math.min(max, Math.max(min, v)); onSave(); }
        };
        wrap.appendChild(i);
        return wrap;
    };
    row2.appendChild(mkNum('自动整理(条)', 'summarizeEvery', 0, 200, '每收到这么多条消息整理一次记忆；0=关闭自动'));
    row2.appendChild(mkNum('冷却(秒)', 'summarizeCooldown', 10, 3600));
    row2.appendChild(mkNum('引导预算', 'tokenBudget', 200, 4000));
    root.appendChild(row2);

    // ── 记忆总览 ──
    const stats = el('div', 'cmcc-stats');
    root.appendChild(stats);

    const listBox = el('div', 'cmcc-list');
    root.appendChild(listBox);

    // ── 底部按钮 ──
    const btns = el('div', 'cmcc-btns');
    const mkBtn = (label, fn, cls) => {
        const b = el('button', 'menu_button ' + (cls || ''), label);
        b.onclick = fn;
        return b;
    };
    btns.appendChild(mkBtn('立即整理记忆', () => api.summarize(true)));
    root.appendChild(btns);

    // ─────────────────────────────
    // 渲染
    // ─────────────────────────────

    function renderList(snap) {
        listBox.innerHTML = '';
        const worlds = snap.stats.worlds;

        if (!worlds.length) {
            listBox.appendChild(el('div', 'cmcc-empty',
                '还没有任何记忆。选好角色卡后，去玩任意一张卡就会开始记录。'));
            return;
        }

        for (const w of worlds.slice(0, 12)) {
            const card = el('div', 'cmcc-world');

            // 世界标题（可改名）
            const wh = el('div', 'cmcc-world-head');
            const wt = el('span', 'cmcc-world-title', `${w.label}`);
            wt.title = '点击改名';
            wt.onclick = async () => {
                const v = await ctx.callGenericPopup('重命名这个世界：', ctx.POPUP_TYPE.INPUT, w.label);
                if (v) await api.renameWorld(w.key, v);
            };
            wh.appendChild(wt);
            wh.appendChild(el('span', 'cmcc-meta', `${w.saveCount} 次 / ${w.count} 条`));
            card.appendChild(wh);

            // 每个存档
            for (const s of w.saves) {
                const sd = el('div', 'cmcc-save');
                const sh = el('div', 'cmcc-save-head');
                const st = el('span', 'cmcc-save-title', s.label);
                st.title = '点击改名';
                st.onclick = async () => {
                    const v = await ctx.callGenericPopup('重命名这次经历：', ctx.POPUP_TYPE.INPUT, s.label);
                    if (v) await api.renameSave(w.key, s.key, v);
                };
                sh.appendChild(st);
                sh.appendChild(el('span', 'cmcc-meta', `${s.count} 条`));

                const del = el('button', 'cmcc-x', '×');
                del.title = '删除这次经历（含全部记忆）';
                del.onclick = async () => {
                    const ok = await ctx.callGenericPopup(
                        `确定删除「${w.label} / ${s.label}」的全部记忆？`, ctx.POPUP_TYPE.CONFIRM);
                    if (ok) await api.deleteSave(w.key, s.key);
                };
                sh.appendChild(del);
                sd.appendChild(sh);

                // 记忆条目
                const wm = snap.worlds?.[w.key];
                const entries = wm?.saves?.[s.key]?.entries || [];
                const ul = el('div', 'cmcc-entries');
                entries.slice(-40).forEach((e, i) => {
                    const realIdx = entries.length - Math.min(40, entries.length) + i;
                    const row = el('div', 'cmcc-entry');
                    const txt = el('span', 'cmcc-entry-text', e.text);
                    txt.title = '点击编辑';
                    txt.onclick = async () => {
                        const v = await ctx.callGenericPopup('修改这条记忆：', ctx.POPUP_TYPE.INPUT, e.text);
                        if (v != null && v !== '') await api.editMemory(w.key, s.key, realIdx, v);
                    };
                    row.appendChild(txt);
                    const x = el('button', 'cmcc-x', '×');
                    x.title = '删除这条';
                    x.onclick = async () => api.deleteMemory(w.key, s.key, realIdx);
                    row.appendChild(x);
                    ul.appendChild(row);
                });
                if (!entries.length) {
                    ul.appendChild(el('div', 'cmcc-empty', '（暂无）'));
                }
                if (entries.length > 40) {
                    ul.appendChild(el('div', 'cmcc-more', `… 还有 ${entries.length - 40} 条更早的（可在世界书里查看）`));
                }
                sd.appendChild(ul);

                // 新增
                const addRow = el('div', 'cmcc-add');
                const addBtn = el('button', 'menu_button cmcc-mini', '+ 加一条');
                addBtn.onclick = async () => {
                    const v = await ctx.callGenericPopup('新增一条记忆：', ctx.POPUP_TYPE.INPUT, '');
                    if (v) await api.addMemory(w.key, s.key, v);
                };
                addRow.appendChild(addBtn);
                sd.appendChild(addRow);

                card.appendChild(sd);
            }

            if (w.saveCount > 4) {
                card.appendChild(el('div', 'cmcc-more', `… 这个世界还有 ${w.saveCount - 4} 次更早的经历`));
            }
            listBox.appendChild(card);
        }

        // 共同记忆
        if (snap.shared?.length) {
            const card = el('div', 'cmcc-world cmcc-shared');
            card.appendChild(el('div', 'cmcc-world-head',
                `<span class="cmcc-world-title">共同记忆</span>`
                + `<span class="cmcc-meta">${snap.shared.length} 条</span>`));
            const ul = el('div', 'cmcc-entries');
            snap.shared.forEach((e, i) => {
                const row = el('div', 'cmcc-entry');
                const txt = el('span', 'cmcc-entry-text', e.text);
                txt.title = '点击编辑';
                txt.onclick = async () => {
                    const v = await ctx.callGenericPopup('修改：', ctx.POPUP_TYPE.INPUT, e.text);
                    if (v != null && v !== '') await api.editShared(i, v);
                };
                row.appendChild(txt);
                const x = el('button', 'cmcc-x', '×');
                x.onclick = async () => api.deleteShared(i);
                row.appendChild(x);
                ul.appendChild(row);
            });
            card.appendChild(ul);
            const addRow = el('div', 'cmcc-add');
            const addBtn = el('button', 'menu_button cmcc-mini', '+ 加一条');
            addBtn.onclick = async () => {
                const v = await ctx.callGenericPopup('新增共同记忆：', ctx.POPUP_TYPE.INPUT, '');
                if (v) await api.addShared(v);
            };
            addRow.appendChild(addBtn);
            card.appendChild(addRow);
            listBox.appendChild(card);
        }
    }

    async function refresh() {
        let snap;
        try {
            snap = api.snapshot();
        } catch (e) {
            stats.innerHTML = '<div class="cmcc-empty">读取失败，看控制台</div>';
            return;
        }
        const s = snap.stats;
        let cur = { wKey: '', sKey: '', wLabel: '' };
        try { cur = api.currentPos(); } catch (e) { /* ignore */ }

        stats.innerHTML = [
            `<b>记忆世界书</b>：<code>${snap.bookName}</code>`,
            `<b>共</b> ${s.worldCount} 个世界 / ${s.totalEntries} 条记忆`
            + (snap.shared?.length ? ` / 共同记忆 ${snap.shared.length} 条` : ''),
            `当前位置：${cur.wLabel || '—'}`,
            '<span class="cmcc-hint">提示：点世界名/存档名可改名，点记忆可编辑，'
            + '也能用「打开记忆世界书」到 ST 编辑器里批量改。</span>',
        ].map((x) => `<div class="cmcc-stat-line">${x}</div>`).join('');

        renderList(snap);
    }

    // 挂载
    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    host?.appendChild(root);

    // 首帧
    refresh();

    return { refresh };
}
