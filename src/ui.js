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
 *
 * ★ 默认**收起**（用户要求）：这个面板内容不少（人设要点开、参数一堆），
 *   每次进扩展设置都自己弹开会很吵。收起时标题行仍能看到启用开关。
 *   点标题行展开后会记住状态，改设置触发重渲染也不会自己弹回去。
 */
let SETTINGS_EXPANDED = false;

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
     * ★ 完全照抄 ST 自己的 toggleDrawer（utils.js）：**只切 display**，
     *   没有任何 max-height / 动画。
     *
     * 我在这里连踩三个坑，最后发现全是自找的：
     *   ① 先用 class 切（displayNone）—— .inline-drawer-content 默认就是
     *      display:none，切 class 没有任何效果。
     *   ② 改用 JS 量高度 + max-height 过渡 —— 量的时候容器已被压到 0，
     *      量出来还是 0，永远展不开（表现为"点了没反应"）。
     *   ③ 把量高度改成先放开 max-height 再量 —— 还是不行，因为我在 CSS 里
     *      给 .inline-drawer-content 写了 padding-top:6px，
     *      而 **max-height 限制的是内容盒子，padding 加在外面** →
     *      max-height:0 时元素仍有 6px 高，我量到的永远是 6px。
     *
     * 诊断数据（用户提供）明确显示：
     *   内联 max-height = 1157px，但计算 max-height = 0px，实测高度 = 6px
     *   —— 6px 正是那个 padding。
     *
     * 结论：**别自作聪明做动画**。ST 怎么做就怎么做，最稳。
     */
    const applyExpand = (open) => {
        SETTINGS_EXPANDED = open;
        if (open) {
            chev.classList.remove('down', 'fa-circle-chevron-down');
            chev.classList.add('up', 'fa-circle-chevron-up');
            content.style.removeProperty('max-height');   // 清掉历史遗留
            content.style.display = 'block';
        } else {
            chev.classList.remove('up', 'fa-circle-chevron-up');
            chev.classList.add('down', 'fa-circle-chevron-down');
            content.style.removeProperty('max-height');
            content.style.display = 'none';
        }
    };
    const toggleHandler = () => {
        console.log('[CMCC] 设置页标题被点击: SETTINGS_EXPANDED =', SETTINGS_EXPANDED);
        applyExpand(!SETTINGS_EXPANDED);
        console.log('[CMCC] 切换后:', SETTINGS_EXPANDED ? '展开' : '收起',
            '| display =', JSON.stringify(content.style.display),
            '| 实测高度 =', Math.round(content.getBoundingClientRect().height));
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

    /**
     * 重建面板内容
     *
     * ★ 为什么要有这个函数（真实 bug）：
     *   原来 `refresh()` **只更新「记忆总览」**，从不重建人设下拉和那四个输入框。
     *   于是删掉一个人设之后：
     *     · activeBuiltinId 已经变了，但下拉和输入框还显示旧的 → 看起来"没删掉"
     *     · 更糟的是，那些输入框的 onchange 会把**旧内容写进新激活的人设**
     *       → 于是出现「只留下名字、其他内容没了」
     *   （用户报的就是这个。）
     *
     *   现在把整块内容的创建包进这个函数，结构性变更后整块重建。
     */
    // ★ 这两个元素由 rebuildInner 赋值，但**声明在外层** ——
    //   因为 refreshStats() 要用它们，而它不在 rebuildInner 里面。
    //   如果在这里 const 声明，每次重建都会换对象，refreshStats 就更新到旧的了。
    let ovSummary = null;
    let stats = null;

    function rebuildInner() {
        inner.innerHTML = '';

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
        // ── 内置人设：多个预设（用户要求：原来只有一个，没法同时存多个）──
        const list = (typeof api.listPersonas === 'function' ? api.listPersonas() : []) || [];
        const activeId = (settings.activeBuiltinId) || (list[0] && list[0].id) || '';

        const pbar = el('div', 'cmcc-pbar');

        const psel = document.createElement('select');
        psel.className = 'text_pole cmcc-select';
        if (!list.length) {
            const o = document.createElement('option');
            o.value = ''; o.textContent = '（还没有人设）';
            psel.appendChild(o);
        }
        for (const it of list) {
            const o = document.createElement('option');
            o.value = it.id;
            o.textContent = it.name + (it.descLen ? '' : '（空）');
            if (it.id === activeId) o.selected = true;
            psel.appendChild(o);
        }
        psel.onchange = async () => {
            await api.setActivePersona(psel.value);
            refresh();
        };
        pbar.appendChild(psel);

        // 新建 / 复制
        const bAdd = el('button', 'menu_button cmcc-mini', '新建');
        bAdd.title = '新建一个空人设';
        bAdd.onclick = async () => {
            const name = await ctx.callGenericPopup('新人设的名字：', ctx.POPUP_TYPE.INPUT, '新角色');
            if (name == null || name === '') return;
            await api.addPersona(name, false);
            refresh();
        };
        pbar.appendChild(bAdd);

        const bCopy = el('button', 'menu_button cmcc-mini', '复制');
        bCopy.title = '复制当前人设（含全部内容）';
        bCopy.onclick = async () => {
            const name = await ctx.callGenericPopup('副本的名字：', ctx.POPUP_TYPE.INPUT,
                ((settings.builtin || {}).name || '同伴') + ' 副本');
            if (name == null || name === '') return;
            await api.addPersona(name, true);
            refresh();
        };
        pbar.appendChild(bCopy);

        const bDel = el('button', 'menu_button cmcc-mini cmcc-danger', '删除');
        bDel.title = '删除当前人设（至少保留一个）';
        bDel.disabled = list.length <= 1;
        bDel.onclick = async () => {
            const cur = list.find((x) => x.id === activeId);
            const ok = await ctx.callGenericPopup(
                `删除人设「${cur ? cur.name : ''}」？\n（记忆不会跟着删，仍在这个世界里）`,
                ctx.POPUP_TYPE.CONFIRM);
            if (!ok) return;
            await api.deletePersona(activeId);
            refresh();
        };
        pbar.appendChild(bDel);

        const bRen = el('button', 'menu_button cmcc-mini', '改名');
        bRen.title = '只改这个预设的名字（上面的"名字"字段是角色名）';
        bRen.onclick = async () => {
            const cur = list.find((x) => x.id === activeId);
            const name = await ctx.callGenericPopup('预设名字：', ctx.POPUP_TYPE.INPUT,
                cur ? cur.name : '');
            if (name == null || name === '') return;
            await api.renamePersona(activeId, name);
            refresh();
        };
        pbar.appendChild(bRen);

        builtinBox.appendChild(pbar);
        builtinBox.appendChild(el('div', 'cmcc-hint',
            `共 <b>${list.length}</b> 个人设预设，切换预设会同时换掉她的名字/描述/性格/关系。`));

        // ── 导出 / 导入（人设 + 记忆一起带走）──
        const ebar = el('div', 'cmcc-pbar');
        const bExp = el('button', 'menu_button cmcc-mini', '导出人设+记忆');
        bExp.title = '把人设和这个世界书里的全部记忆导出成一个 JSON 文件';
        bExp.onclick = async () => {
            try {
                const data = await api.exportAll(activeId);
                const json = JSON.stringify(data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const nm = ((data.persona && data.persona.name) || 'CMCC').replace(/[\\/:*?"<>|]/g, '_');
                a.href = url;
                a.download = `CMCC-${nm}-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 3000);
                const nEnt = Object.values(data.worlds || {}).reduce(
                    (n, w) => n + Object.values(w.saves || {}).reduce((m, s) => m + (s.entries || []).length, 0), 0);
                ctx.toastr?.success?.(`已导出：人设 + ${nEnt} 条记忆`);
            } catch (e) {
                ctx.toastr?.error?.('导出失败：' + e.message);
            }
        };
        ebar.appendChild(bExp);

        const bImp = el('button', 'menu_button cmcc-mini', '导入');
        bImp.title = '导入之前导出的 JSON（记忆按内容去重合并，不会覆盖）';
        bImp.onclick = () => {
            const fi = document.createElement('input');
            fi.type = 'file';
            fi.accept = '.json,application/json';
            fi.onchange = async () => {
                const f = fi.files && fi.files[0];
                if (!f) return;
                try {
                    const txt = await f.text();
                    const obj = JSON.parse(txt);

                    // ⚠ 这里原来写成「确定=新预设 / 取消=覆盖」，
                    //   而 callGenericPopup 的 CONFIRM 在用户点「否」时返回 false，
                    //   `!!ok` 就是 false → **静默覆盖当前人设**。
                    //   太危险。改成三个明确选项，并且把按钮文字写清楚
                    //   （弹窗是纯文本，不解析 Markdown，所以不要写 ** 星号）。
                    const nMem = (function count(o) {
                        let n = 0;
                        for (const w of Object.values(o?.worlds || {})) {
                            for (const s of Object.values(w?.saves || {})) n += (s?.entries || []).length;
                        }
                        return n;
                    })(obj);
                    const pName = obj?.persona?.name ? `「${obj.persona.name}」` : '（这份文件里没有人设）';

                    // 三个选项。
                    // ⚠ ST 的 customButtons 里，字符串项会被转成
                    //     { text: x, result: index + 2 }
                    //     （见 popup.js：「typeof x === 'string' ? { text: x, result: index + 2 } : x」）
                    //   所以：
                    //     · 用对象的话，属性名必须是 text / result ——
                    //       我原来写的是 label / value，结果 result 是 undefined，
                    //       点「覆盖」返回 null，被当成"取消"，导入根本不执行。
                    //     · 用字符串最省事，ST 自己补 result。
                    //   返回值：true = 新建（POPUP_RESULT.AFFIRMATIVE）
                    //           2   = 覆盖（第一个 customButtons）
                    //           null= 取消（POPUP_RESULT.CANCELLED）
                    const OK_NEW = true;
                    const RES_OVERWRITE = 2;

                    const choice = await ctx.callGenericPopup(
                        `要导入的内容：人设 ${pName}，记忆 ${nMem} 条。\n\n`
                        + '「新建」—— 作为新预设加入，不影响你现在的角色（推荐）\n'
                        + '「覆盖」—— 用它替换掉当前预设的人设\n'
                        + '「取消」—— 什么都不做\n\n'
                        + '记忆都是按内容去重追加的，任何时候都不会被覆盖。',
                        ctx.POPUP_TYPE.CONFIRM,
                        '',
                        {
                            okButton: '新建',
                            cancelButton: '取消',
                            customButtons: ['覆盖'],
                        });

                    if (choice === null || choice === undefined || choice === false) {
                        ctx.toastr?.info?.('已取消导入');
                        return;
                    }
                    if (choice === RES_OVERWRITE) {
                        const sure = await ctx.callGenericPopup(
                            `确定要用 ${pName} 覆盖当前预设的人设吗？\n`
                            + '（记忆不受影响，只是人设被替换）',
                            ctx.POPUP_TYPE.CONFIRM, '',
                            { okButton: '覆盖', cancelButton: '算了' });
                        if (sure !== true) { ctx.toastr?.info?.('已取消'); return; }
                    }

                    const r = await api.importAll(obj, choice === OK_NEW);
                    ctx.toastr?.success?.(
                        `导入完成：人设「${r.persona || '（无）'}」，`
                        + `新增 ${r.worlds} 个世界 / ${r.saves} 个存档 / ${r.entries} 条记忆`
                        + (r.skipped ? `（${r.skipped} 条重复已跳过）` : ''));
                    refresh();
                } catch (e) {
                    ctx.toastr?.error?.('导入失败：' + e.message);
                }
            };
            fi.click();
        };
        ebar.appendChild(bImp);
        builtinBox.appendChild(ebar);
        builtinBox.appendChild(el('div', 'cmcc-hint',
            '导出的是一个 JSON 文件，里面包含<b>人设</b>和<b>全部记忆</b>，换电脑时导入即可继续。'));

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
    row2.appendChild(mkNum('引导预算', 'tokenBudget', 600, 12000));
    row2.appendChild(mkNum('最近记忆(条)', 'recentMemoryLimit', 0, 50,
        '注入多少条「最近」的记忆（建议 5~10）'));
    row2.appendChild(mkNum('相似旧事(条)', 'relevantMemoryLimit', 0, 20,
        '注入多少条「和眼前相似的旧事」（建议 2~5）'));
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
    ovSummary = el('span', 'cmcc-meta cmcc-ov-summary', '');
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

    stats = el('div', 'cmcc-stats cmcc-ov-body');
    sec3.appendChild(stats);
    inner.appendChild(sec3);

    function applyOverview() {
        const chev = ovHead.querySelector('.cmcc-chev2');
        if (chev) chev.textContent = OVERVIEW_OPEN ? '▾' : '▸';
        stats.style.display = OVERVIEW_OPEN ? 'block' : 'none';
    }
    applyOverview();

    // ── 赞助（爱发电）──
    // 用户要求单独出一个按钮。放在最底部，不打扰日常使用。
    const sec4 = el('div', 'cmcc-sec cmcc-support');
    const srow = el('div', 'cmcc-support-row');
    const stxt = el('div', 'cmcc-support-text');
    stxt.innerHTML = '<b>如果它帮到你了</b><br>'
        + '<span class="cmcc-hint">完全自愿，不影响任何功能。</span>';
    srow.appendChild(stxt);

    const bAfd = el('a', 'menu_button cmcc-support-btn');
    bAfd.href = 'https://afdian.com/a/WhiteShawqi';
    bAfd.target = '_blank';
    bAfd.rel = 'noopener noreferrer';
    bAfd.title = '在爱发电支持作者（会在新标签页打开）';
    bAfd.innerHTML = '<span class="cmcc-support-ico">♥</span> 爱发电赞助';
    srow.appendChild(bAfd);
    sec4.appendChild(srow);
    inner.appendChild(sec4);

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

    }   // ── rebuildInner 结束 ──

    /**
     * 只刷新「记忆总览」的数字，不重建整块内容
     *
     * ⚠ ovSummary / stats 是**外层声明的变量**，由 rebuildInner 赋值。
     *   不能在这里 const 重新绑定 —— 那样每次重建都会换一个对象，
     *   而 refreshStats 里引用的还是旧的，更新就落空了。
     */
    function refreshStats() {
        // 还没建过（理论上不会发生，但防止 rebuildInner 抛错后崩在这）
        if (!ovSummary || !stats) return;
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

    /**
     * 刷新面板 —— **永远整块重建**
     *
     * 为什么不做成"只有结构性变更才重建"：
     *   我试过。那个条件分支踩了两个坑 ——
     *     ① 只在记忆总览更新时不重建人设栏 → 删了人设界面不变，
     *        而且旧输入框的 onchange 会把旧内容写进新激活的人设
     *     ② 首屏调用忘了传参数 → rebuild 为假 → 整块空白
     *   整块重建很便宜（几十个元素），不值得为这点性能冒两个 bug 的险。
     *
     * ★ 外层还有一道兜底：重建后如果人设下拉的数量和 settings 对不上，
     *   就把整个面板拆了重挂（见 ensureConsistent）。
     */
    function refresh() {
        try {
            rebuildInner();
        } catch (e) {
            console.error('[CMCC] 重建设置面板失败 —— 这会导致界面不更新', e);
            ctx.toastr?.error?.('设置面板刷新失败：' + (e && e.message));
        }
        try {
            refreshStats();
        } catch (e) {
            console.warn('[CMCC] 刷新记忆总览失败', e);
        }
        ensureConsistent();
    }

    /**
     * 兜底：界面里的人设数量必须和 settings 里的一致
     *
     * 如果对不上（比如重建中途抛错、或 api.listPersonas 返回异常），
     * 就把面板整个拆掉重挂一次。宁可闪一下，也不能让界面停在错误状态 ——
     * 用户报的「导入后没有显示 / 删了人设界面不变」就是界面停在错误状态。
     */
    function ensureConsistent() {
        if (!root.parentElement) return;      // 还没挂上，不用管
        let expect = null;
        try {
            expect = (typeof api.listPersonas === 'function' ? api.listPersonas() : []).length;
        } catch (e) { return; }
        if (expect === null) return;

        const shown = (function () {
            const sel = root.querySelector('.cmcc-select');
            return sel ? sel.children.length : -1;
        })();

        if (shown === expect) return;

        console.warn('[CMCC] 面板显示 %d 个人设，settings 里有 %d 个 —— 整个面板重挂一次',
            shown, expect);
        try {
            root.remove();
            renderPanel({ settings, onSave, ctx, api, onOpenTop });
        } catch (e) {
            console.error('[CMCC] 重挂面板也失败了', e);
        }
    }

    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    host?.appendChild(root);   // 初始状态已在上方定好，这里不再改（改了会触发过渡）
    refresh();   // 首屏渲染一次（此时已挂到 DOM 上）
    return {
        refresh,
        expand: () => applyExpand(true),
        collapse: () => applyExpand(false),
    };
}
