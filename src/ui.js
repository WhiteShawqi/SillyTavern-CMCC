/**
 * CMCC · 扩展设置页（和酒馆助手同位置）
 *
 * 职责划分：
 *   这里     —— 切换「哪个角色做陪伴者」+ 开关与参数 + 记忆总览（只读）
 *   顶部入口 —— 改人设 + 改记忆（日常编辑都走那里）
 */

const ID = 'cmcc_settings';

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
 * @param {object} o.api
 * @param {() => void} o.onOpenTop   打开顶部面板
 */
export function renderPanel(o) {
    const { settings, onSave, ctx, api, onOpenTop } = o;
    document.getElementById(ID)?.remove();

    const root = el('div', 'cmcc-panel');
    root.id = ID;

    // ── 标题 ──
    const head = el('div', 'cmcc-head');
    head.innerHTML = '<b>跨世界陪伴角色</b>'
        + '<span class="cmcc-sub">CMCC · 一个固定的角色，记得你们经历的一切</span>';
    const toggle = el('label', 'cmcc-switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!settings.enabled;
    cb.onchange = () => {
        settings.enabled = cb.checked;
        onSave();
        if (cb.checked) api.reload().then(refresh);
    };
    toggle.appendChild(cb);
    toggle.appendChild(el('span', null, '启用'));
    head.appendChild(toggle);
    root.appendChild(head);

    // ── 切换陪伴者（本页核心）──
    const sec1 = el('div', 'cmcc-sec');
    sec1.appendChild(el('div', 'cmcc-sec-title', '陪伴角色'));
    const row1 = el('div', 'cmcc-row');
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
        refresh();
    };
    row1.appendChild(sel);
    sec1.appendChild(row1);
    sec1.appendChild(el('div', 'cmcc-hint',
        '换人之后，她的人设会同步进记忆世界书。原来的记忆保留（按世界分着存）。'));

    const quick = el('div', 'cmcc-btns');
    const bOpen = el('button', 'menu_button cmcc-wide-btn', '打开顶部面板（改人设 / 记忆）');
    bOpen.onclick = () => onOpenTop();
    quick.appendChild(bOpen);
    const bSum = el('button', 'menu_button', '立即整理记忆');
    bSum.onclick = () => api.summarize(true);
    quick.appendChild(bSum);
    const bNew = el('button', 'menu_button', '手动加一条记忆');
    bNew.title = '给当前世界/存档加一条记忆（不改人设）';
    bNew.onclick = async () => {
        let pos;
        try { pos = api.currentPos(); } catch (e) { pos = null; }
        if (!pos) { ctx.toastr?.warning?.('读不到当前位置'); return; }
        const v = await ctx.callGenericPopup('要记住什么？', ctx.POPUP_TYPE.INPUT, '');
        if (!v) return;
        await api.addMemory(pos.wKey, pos.sKey, v);
        ctx.toastr?.success?.('已加入「' + (pos.wLabel || '当前世界') + '」');
        refresh();
    };
    quick.appendChild(bNew);
    sec1.appendChild(quick);
    root.appendChild(sec1);

    // ── 选项 ──
    const sec2 = el('div', 'cmcc-sec');
    sec2.appendChild(el('div', 'cmcc-sec-title', '行为'));
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
    sec2.appendChild(opts);

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
    row2.appendChild(mkNum('自动整理(条)', 'summarizeEvery', 0, 200, '每收到这么多消息整理一次；0=关闭自动'));
    row2.appendChild(mkNum('冷却(秒)', 'summarizeCooldown', 10, 3600));
    row2.appendChild(mkNum('引导预算', 'tokenBudget', 200, 4000));
    sec2.appendChild(row2);
    root.appendChild(sec2);

    // ── 记忆总览（只读）──
    const sec3 = el('div', 'cmcc-sec');
    sec3.appendChild(el('div', 'cmcc-sec-title', '记忆总览'));
    const stats = el('div', 'cmcc-stats');
    sec3.appendChild(stats);
    root.appendChild(sec3);

    function refresh() {
        let snap;
        try { snap = api.snapshot(); } catch (e) {
            stats.innerHTML = '<div class="cmcc-empty">读取失败</div>';
            return;
        }
        const s = snap.stats;
        let cur = { wLabel: '' };
        try { cur = api.currentPos(); } catch (e) { /* ignore */ }
        const rows = [
            `<b>记忆世界书</b>：<code>${snap.bookName}</code>`,
            `<b>记忆</b>：${s.worldCount} 个世界 / ${s.totalEntries} 条`
            + (snap.shared?.length ? ` / 共同 ${snap.shared.length} 条` : ''),
            `当前位置：${cur.wLabel || '—'}`,
        ];
        for (const w of s.worlds.slice(0, 8)) {
            const saves = w.saves.slice(0, 4).map((x) => `${x.label}(${x.count})`).join('、');
            rows.push(`<div class="cmcc-world-line">`
                + `<b>${w.label}</b> — ${w.saveCount} 次 / ${w.count} 条`
                + `<div class="cmcc-saves">${saves}${w.saves.length > 4 ? ' …' : ''}</div></div>`);
        }
        if (s.worlds.length > 8) rows.push(`… 还有 ${s.worlds.length - 8} 个世界`);
        if (!s.worldCount) rows.push('<span class="cmcc-hint">还没有记忆。选好角色卡后去玩任意一张卡。</span>');
        rows.push('<span class="cmcc-hint">改记忆 / 改人设请点上面「打开顶部面板」，'
            + '或用酒馆顶部那个图标。</span>');
        stats.innerHTML = rows.map((x) => `<div class="cmcc-stat-line">${x}</div>`).join('');
    }
    refresh();

    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    host?.appendChild(root);
    return { refresh };
}
