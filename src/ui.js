/**
 * CMCC · 扩展设置页（和酒馆助手同位置）
 *
 * 职责划分：
 *   这里     —— 切换「哪个角色做陪伴者」+ 创建新角色 + 开关参数 + 记忆总览
 *   顶部入口 —— 改人设 + 改记忆（日常编辑都走那里）
 *
 * 结构：用 ST 官方的 `.inline-drawer` 模式，可收起（与其它扩展一致）
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

    // ── 外层：ST 标准 inline-drawer（可收起）──
    const root = el('div', 'cmcc-panel');
    root.id = ID;

    const drawer = el('div', 'inline-drawer');

    const toggle = el('div', 'inline-drawer-toggle inline-drawer-header');
    toggle.innerHTML = '<b>跨世界陪伴角色</b>'
        + '<span class="cmcc-sub">CMCC · 一个固定的角色，记得你们经历的一切</span>';
    const chev = el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down');
    toggle.appendChild(chev);
    drawer.appendChild(toggle);

    const content = el('div', 'inline-drawer-content');
    drawer.appendChild(content);
    root.appendChild(drawer);

    // 收起逻辑：照抄 ST 的 toggleDrawer（utils.js:2533）
    // 关键：它操作的是 content 的**内联 display**，不是 class。
    // 我上一版用了 displayNone class，而 .inline-drawer-content 默认就是 display:none，
    // 所以切换 class 没有任何效果 → 表现为"收不起来"。
    let expanded = true;
    const applyExpand = (open) => {
        expanded = open;
        if (open) {
            chev.classList.remove('down', 'fa-circle-chevron-down');
            chev.classList.add('up', 'fa-circle-chevron-up');
            content.style.display = 'block';
        } else {
            chev.classList.remove('up', 'fa-circle-chevron-up');
            chev.classList.add('down', 'fa-circle-chevron-down');
            content.style.display = 'none';
        }
    };
    toggle.addEventListener('click', () => applyExpand(!expanded));

    // ── 启用开关（放在标题行，收起时也能操作）──
    const sw = el('label', 'cmcc-switch cmcc-switch-inline');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!settings.enabled;
    cb.onchange = () => {
        settings.enabled = cb.checked;
        onSave();
        if (cb.checked) api.reload().then(refresh);
    };
    sw.appendChild(cb);
    sw.appendChild(el('span', null, '启用'));
    sw.onclick = (e) => e.stopPropagation();   // 别触发抽屉收起
    toggle.appendChild(sw);

    // ══════════════════════════════════
    // 内容区
    // ══════════════════════════════════

    // ── 陪伴角色 ──
    const sec1 = el('div', 'cmcc-sec');
    sec1.appendChild(el('div', 'cmcc-sec-title', '陪伴角色'));

    // 来源选择：内置（默认） / 用已有角色卡
    const modeRow = el('div', 'cmcc-mode-row');
    const mkMode = (mode, label, title) => {
        const l = el('label', 'cmcc-radio');
        if (title) l.title = title;
        const i = document.createElement('input');
        i.type = 'radio';
        i.name = 'cmcc-persona-mode';
        i.value = mode;
        i.checked = (settings.personaMode || 'builtin') === mode;
        i.onchange = async () => {
            if (!i.checked) return;
            await api.setPersonaMode(mode);
            refresh();
        };
        l.appendChild(i);
        l.appendChild(el('span', null, label));
        return l;
    };
    modeRow.appendChild(mkMode('builtin', '内置角色（独立）',
        '人设存在扩展设置里，不注册进角色卡库，也不占用原生世界书'));
    modeRow.appendChild(mkMode('card', '用已有角色卡',
        '从角色库里选一张卡作为陪伴者'));
    sec1.appendChild(modeRow);

    const isBuiltin = (settings.personaMode || 'builtin') === 'builtin';
    const builtinBox = el('div', 'cmcc-builtin');

    if (isBuiltin) {
        // ── 内置人设编辑（完全独立，不碰原生角色卡）──
        const b = settings.builtin || {};
        const fields = [
            ['name', '名字', b.name || '', '一行即可'],
            ['description', '角色描述', b.description || '', '她是谁、外貌、身份（多行）'],
            ['personality', '性格', b.personality || '', '性格、说话方式、行为倾向（多行）'],
            ['scenario', '与你的关系', b.scenario || '', '她和你是什么关系（多行）'],
        ];
        for (const [key, label, val, hint] of fields) {
            const row = el('div', 'cmcc-field cmcc-field-edit');
            const lab = el('label', 'cmcc-field-label', label);
            lab.title = hint || '';
            row.appendChild(lab);
            let input;
            if (key === 'name') {
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'text_pole';
                input.value = val;
                input.placeholder = '给她起个名字';
            } else {
                input = document.createElement('textarea');
                input.className = 'text_pole';
                input.rows = key === 'description' ? 3 : 2;
                input.value = val;
                input.placeholder = hint || '';
            }
            input.onchange = async () => {
                await api.setBuiltin({ [key]: input.value });
                refresh();
            };
            row.appendChild(input);
            builtinBox.appendChild(row);
        }
        builtinBox.appendChild(el('div', 'cmcc-hint',
            '她是<b>独立</b>的：不写进角色卡库，也不依赖原生世界书。'
            + '记忆直接注入提示词，所以不用去挂载任何世界书。'));
    } else {
        // ── 用已有角色卡 ──
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

        const bCreate = el('button', 'menu_button', '+ 创建新角色');
        bCreate.title = '打开酒馆的「创建角色」对话框；建好后回来这里选它';
        bCreate.onclick = () => {
            const btn = document.getElementById('rm_button_create');
            if (btn) {
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                ctx.toastr?.info?.('建好角色后，回到这里在「陪伴角色」里选它');
                pollForNewCharacter();
            } else {
                ctx.toastr?.warning?.('找不到酒馆的创建角色按钮，请在角色管理里手动创建');
            }
        };
        row1.appendChild(bCreate);
        builtinBox.appendChild(row1);
        builtinBox.appendChild(el('div', 'cmcc-hint',
            '改这张卡的人设会直接写回角色卡本身。'));
    }
    sec1.appendChild(builtinBox);

    // 打开顶部面板（改人设 / 记忆）
    const createRow = el('div', 'cmcc-btns');
    const bOpen = el('button', 'menu_button cmcc-wide-btn', '打开顶部面板（改人设 / 记忆）');
    bOpen.onclick = () => onOpenTop();
    createRow.appendChild(bOpen);
    sec1.appendChild(createRow);

    // 记忆操作
    const actRow = el('div', 'cmcc-btns');
    const bSum = el('button', 'menu_button', '立即整理记忆');
    bSum.onclick = () => api.summarize(true);
    actRow.appendChild(bSum);
    const bNew = el('button', 'menu_button', '手动加一条记忆');
    bNew.title = '给当前世界/存档加一条记忆';
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
    actRow.appendChild(bNew);
    sec1.appendChild(actRow);
    content.appendChild(sec1);

    // ── 行为 ──
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
    opts.appendChild(mkCheck('注入记忆', 'injectMemory',
        '把记忆直接注入提示词（关掉就只靠世界书，需要手动挂载）'));
    opts.appendChild(mkCheck('同步世界书', 'syncWorldbook',
        '额外写一份 CMCC-记忆库，便于用 ST 编辑器查看/编辑记忆'));
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
    row2.appendChild(mkNum('记忆预算', 'memoryBudget', 200, 20000,
        '记忆注入的 token 上限；记忆很多时按此截断'));
    sec2.appendChild(row2);
    content.appendChild(sec2);

    // ── 记忆总览 ──
    const sec3 = el('div', 'cmcc-sec');
    sec3.appendChild(el('div', 'cmcc-sec-title', '记忆总览'));
    const stats = el('div', 'cmcc-stats');
    sec3.appendChild(stats);
    content.appendChild(sec3);

    /** 角色创建后自动刷新下拉（ST 建角色是异步的） */
    function pollForNewCharacter(round = 0) {
        if (round > 20) return;   // 最多等 ~10s
        setTimeout(() => {
            const now = (ctx.characters || []).length;
            if (now !== sel.options.length - 1) {
                rebuildSelect();
                ctx.toastr?.success?.('角色列表已更新，请在「陪伴角色」里选它');
            } else {
                pollForNewCharacter(round + 1);
            }
        }, 500);
    }

    function rebuildSelect() {
        const keep = sel.value;
        sel.innerHTML = '';
        const n2 = document.createElement('option');
        n2.value = '';
        n2.textContent = '—— 未选择 ——';
        sel.appendChild(n2);
        (ctx.characters || []).forEach((c, i) => {
            if (!c) return;
            const opt = document.createElement('option');
            opt.value = c.avatar || String(i);
            opt.textContent = c.name || '(无名)';
            sel.appendChild(opt);
        });
        sel.value = keep;
    }

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
        rows.push('<span class="cmcc-hint">改人设 / 改记忆：点「打开顶部面板」，'
            + '或用酒馆顶部那个人形图标。</span>');
        stats.innerHTML = rows.map((x) => `<div class="cmcc-stat-line">${x}</div>`).join('');
    }
    refresh();

    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    host?.appendChild(root);
    applyExpand(true);   // 默认展开
    return {
        refresh,
        expand: () => applyExpand(true),
        collapse: () => applyExpand(false),
    };
}
