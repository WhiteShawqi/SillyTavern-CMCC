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

/**
 * 设置页抽屉的展开状态（模块级，跨重渲染保持）
 * 之前每次 renderPanel 都重置成"展开"，用户收起后一改设置又自己弹开。
 */
let SETTINGS_EXPANDED = true;

/** 「记忆总览」是否展开（模块级，跨重渲染保持）。默认收起，只看摘要。 */
let OVERVIEW_OPEN = false;

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
    // 过渡用 grid 0fr/1fr，需要一层 overflow:hidden 的内层
    const inner = el('div', 'cmcc-drawer-inner');
    content.appendChild(inner);
    drawer.appendChild(content);
    root.appendChild(drawer);

    // 收起逻辑：照抄 ST 的 toggleDrawer（utils.js:2533）
    // 关键：它操作的是 content 的**内联 display**，不是 class。
    // 我上一版用了 displayNone class，而 .inline-drawer-content 默认就是 display:none，
    // 所以切换 class 没有任何效果 → 表现为"收不起来"。
    /**
     * 展开 / 收起
     *
     * 用 JS 测内层高度 + 设 max-height 做过渡：
     *   · 方向一定正确（展开 max-height 设为实际高度，收起设为 0）
     *   · 不用猜高度，内容多高都行
     * 为什么不用纯 CSS 的 grid 0fr/1fr：收起正常，但展开时算不回固有高度。
     */
    /** 量内容真实高度（先把 max-height 放开，否则可能量到 0） */
    function measureInner() {
        const prev = content.style.maxHeight;
        content.style.maxHeight = 'none';
        const h = Math.max(
            inner.scrollHeight || 0,
            inner.offsetHeight || 0,
            content.scrollHeight || 0,
        );
        content.style.maxHeight = prev;   // 还原（下一行会立刻重设）
        return h;
    }

    /**
     * 展开 / 收起
     *
     * ⚠ 踩过的坑：展开时若先把 max-height 设成 0px 再读 inner.scrollHeight，
     *   容器已被压到 0，量出来还是 0 → 永远展不开（表现为"点了没反应"）。
     *   所以必须先放开限制再量。另外加最小高度兜底，宁可多留白也不能展不开。
     */
    const applyExpand = (open) => {
        SETTINGS_EXPANDED = open;
        if (open) {
            chev.classList.remove('down', 'fa-circle-chevron-down');
            chev.classList.add('up', 'fa-circle-chevron-up');
            content.style.display = 'block';
            if (!content.classList.contains('cmcc-animated')) {
                // 未启用过渡（首屏 / 恢复状态）：直接放开，不播动画
                content.style.maxHeight = '';
                return;
            }
            const target = Math.max(60, measureInner() + 8);
            content.style.maxHeight = '0px';      // 起点
            void content.offsetHeight;            // 让浏览器认下起点
            content.style.maxHeight = target + 'px';
            clearTimeout(content._cmccT);
            content._cmccT = setTimeout(() => {
                // 过渡结束后放开限制，免得内容长高了被卡住
                if (SETTINGS_EXPANDED) content.style.maxHeight = '';
            }, 300);
        } else {
            chev.classList.remove('up', 'fa-circle-chevron-up');
            chev.classList.add('down', 'fa-circle-chevron-down');
            if (!content.classList.contains('cmcc-animated')) {
                content.style.display = 'none';
                return;
            }
            // 收起：先量出当前高度当起点，再压到 0
            const cs = getComputedStyle(content);
            const pad = (parseFloat(cs.paddingTop) || 0)
                      + (parseFloat(cs.paddingBottom) || 0);
            const h = Math.max(measureInner() + pad, 60);
            content.style.maxHeight = h + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '0px';
        }
    };
    const toggleHandler = () => {
        // 诊断日志：设置面板点不动时，这几行能直接说明问题出在哪
        console.log('[CMCC] 设置页标题被点击:',
            'SETTINGS_EXPANDED =', SETTINGS_EXPANDED,
            '| display =', JSON.stringify(content.style.display),
            '| maxHeight =', JSON.stringify(content.style.maxHeight));
        // 第一次点击才启用过渡，并用内联 display 把当前状态落实（首屏不播动画）
        if (!content.classList.contains('cmcc-animated')) {
            content.style.display = 'block';
            content.style.maxHeight = '';
            content.classList.add('cmcc-animated');
            void content.offsetHeight;
        }
        applyExpand(!SETTINGS_EXPANDED);
        console.log('[CMCC] 切换后:',
            '现在', SETTINGS_EXPANDED ? '展开' : '收起',
            '| display =', JSON.stringify(content.style.display),
            '| maxHeight =', JSON.stringify(content.style.maxHeight),
            '| 实测高度 =', Math.round(content.getBoundingClientRect().height));

        // 兜底：展开后若量到高度仍为 0，直接放开限制。
        // 宁可没有动画，也不能"点了没反应"。
        if (SETTINGS_EXPANDED) {
            setTimeout(() => {
                if (!SETTINGS_EXPANDED) return;
                if (content.getBoundingClientRect().height < 10) {
                    content.style.display = 'block';
                    content.style.maxHeight = '';
                    console.warn('[CMCC] 设置页展开后高度仍 <10px，已强制放开 max-height');
                }
            }, 320);
        }
    };
    toggle.addEventListener('click', toggleHandler);

    // ★ 关键：在插入 DOM **之前**就把初始状态定好（首屏不播动画）。
    //   之前写成 appendChild 之后才 applyExpand，浏览器会从基础样式的
    //   display:none 过渡过来，看着像「先播了一遍展开动画」。
    applyExpand(SETTINGS_EXPANDED);

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
    const bClean = el('button', 'menu_button', '清理空存档');
    bClean.title = '删掉没有任何记忆的空存档/空世界';
    bClean.onclick = async () => {
        const r = await api.cleanEmpty();
        ctx.toastr?.success?.('清理了 ' + r.saves + ' 个空存档 / ' + r.worlds + ' 个空世界');
        refresh();
    };
    actRow.appendChild(bClean);
    sec1.appendChild(actRow);
    inner.appendChild(sec1);

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
    opts.appendChild(mkCheck('读取正文记忆块', 'readMemoryCommands',
        'AI 生成正文后，读它输出 `cmcc 块里的内容自动记进记忆（MVU 式）'));
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
    inner.appendChild(sec2);

    // ── 记忆总览（可收起）──
    // 用户反馈：原来是个不美化的长条，也不能收。改成和主面板一样的折叠块，
    // 标题行放一个「摘要」一眼看规模，详细列表收起来。
    const sec3 = el('div', 'cmcc-sec cmcc-ov');
    const ovHead = el('div', 'cmcc-ov-head');
    ovHead.appendChild(el('span', 'cmcc-chev2', OVERVIEW_OPEN ? '▾' : '▸'));
    ovHead.appendChild(el('span', 'cmcc-ov-title', '记忆总览'));
    const ovSummary = el('span', 'cmcc-meta cmcc-ov-summary', '');
    ovHead.appendChild(ovSummary);
    const bTop = el('button', 'menu_button cmcc-mini', '去编辑');
    bTop.title = '打开顶部面板改人设 / 记忆';
    bTop.onclick = (ev) => { ev.stopPropagation(); onOpenTop(); };
    ovHead.appendChild(bTop);
    ovHead.onclick = () => {
        OVERVIEW_OPEN = !OVERVIEW_OPEN;
        applyOverview();
    };
    ovHead.title = '点击展开 / 收起';
    sec3.appendChild(ovHead);

    const stats = el('div', 'cmcc-stats cmcc-ov-body');
    sec3.appendChild(stats);
    inner.appendChild(sec3);

    function applyOverview() {
        const chev = ovHead.querySelector('.cmcc-chev2');
        if (chev) chev.textContent = OVERVIEW_OPEN ? '▾' : '▸';
        stats.style.display = OVERVIEW_OPEN ? 'block' : 'none';
    }
    applyOverview();

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
        // 标题行的摘要（收起状态也能一眼看到规模）
        ovSummary.textContent = s.worldCount
            ? `${s.worldCount} 个世界 · ${s.totalEntries} 条 · 当前 ${cur.wLabel || '—'}`
            : '还是空的';

        // 卡片式布局
        const rows = [];
        rows.push('<div class="cmcc-ov-cards">'
            + `<div class="cmcc-ov-card"><span class="cmcc-ov-num">${s.worldCount}</span>`
            + '<span class="cmcc-ov-lab">个世界</span></div>'
            + `<div class="cmcc-ov-card"><span class="cmcc-ov-num">${s.totalEntries}</span>`
            + '<span class="cmcc-ov-lab">条记忆</span></div>'
            + `<div class="cmcc-ov-card"><span class="cmcc-ov-num">${s.sharedCount || snap.shared?.length || 0}</span>`
            + '<span class="cmcc-ov-lab">条共同</span></div>'
            + '</div>');

        rows.push(`<div class="cmcc-ov-line"><span class="cmcc-ov-k">记忆世界书</span>`
            + `<code>${snap.bookName}</code></div>`);
        rows.push(`<div class="cmcc-ov-line"><span class="cmcc-ov-k">当前位置</span>`
            + `${cur.wLabel || '—'}</div>`);

        for (const w of s.worlds.slice(0, 8)) {
            const saves = w.saves.slice(0, 4)
                .map((x) => `<span class="cmcc-ov-tag">${x.label}<i>${x.count}</i></span>`)
                .join('');
            rows.push(`<div class="cmcc-world-line">`
                + `<div class="cmcc-ov-wrow"><b>${w.label}</b>`
                + `<span class="cmcc-meta">${w.saveCount} 个存档 · ${w.count} 条记忆</span></div>`
                + `<div class="cmcc-saves">${saves}`
                + `${w.saves.length > 4 ? '<span class="cmcc-ov-tag">…</span>' : ''}</div></div>`);
        }
        if (s.worlds.length > 8) {
            rows.push(`<div class="cmcc-ov-line cmcc-hint">… 还有 ${s.worlds.length - 8} 个世界</div>`);
        }
        if (!s.worldCount) {
            rows.push('<div class="cmcc-hint cmcc-ov-empty">'
                + '<b>记忆是空的</b> —— 这是正常的，默认只有人设。<br>'
                + '开始玩之后，她会把值得记的事自动记下来（读正文里的 <code>cmcc</code> 块）。</div>');
        }
        stats.innerHTML = rows.map((x) => `<div class="cmcc-stat-line">${x}</div>`).join('');
    }
    refresh();

    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    host?.appendChild(root);   // 初始状态已在上方定好，这里不再改（改了会触发过渡）
    return {
        refresh,
        expand: () => applyExpand(true),
        collapse: () => applyExpand(false),
    };
}
