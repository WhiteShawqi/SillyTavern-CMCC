/**
 * CMCC · 弹出式编辑器（改人设 / 改记忆的唯一界面）
 *
 * 为什么是弹窗而不是酒馆顶部那条图标：
 *   顶部图标只放一个「人」实在挤，而且酒馆顶部那一排是它自己的地盘。
 *   改成从扩展设置里点「打开编辑器」弹出一个大窗口，
 *   里面用**标签页 + 内部折叠**分类 —— 内容不少，得有个层次。
 *
 * 标签页：
 *   陪伴角色 —— 当前是谁、诊断信息、启用状态
 *   人设     —— 四个字段（名字/描述/性格/关系），点一下就能改
 *   记忆     —— 记忆树（世界 → 存档 → 记忆）、多选批量删、按范围删
 *   关于     —— 手动更新、爱发电、版本信息
 *
 * ⚠ 这个文件把原来 topbar.js 里的渲染逻辑搬了过来。
 *   状态（折叠 / 多选）在 selection.js 里，两个界面共用一份。
 */

import {
    isCollapsed, toggleCollapsed, collapseAll, clearCollapsed,
    SELECTED, SELECTED_WORLDS, SELECTED_SAVES,
    getSelectMode, setSelectMode, clearSelection,
    entryKey, parseEntryKey, saveKeyId,
    setSaveEntries, setWorldAll, saveSelState, worldSelState, selectedTotal,
} from './selection.js';
// 只剩这两个工具函数还在 topbar.js（打开世界书面板 / 判断世界书有没有挂载）
import { openWorldBook, isWorldBookActive } from './topbar.js';

const LOG_TAG = '[CMCC]';

/** 扩展文件夹名 —— 手动更新要用 */
export const EXTENSION_FOLDER = 'SillyTavern-CMCC';

/** 爱发电 */
export const AFDIAN_URL = 'https://afdian.com/a/WhiteShawqi';

/** 当前选中的标签页（模块级，重开时保持） */
let ACTIVE_TAB = 'companion';

/** 标签定义 */
const TABS = [
    { id: 'companion', label: '陪伴角色' },
    { id: 'persona', label: '人设' },
    { id: 'memory', label: '记忆' },
    { id: 'about', label: '关于' },
];

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}

// ══════════════════════════════════════════════
// 内部折叠小节
// ══════════════════════════════════════════════

/**
 * 做一个可折叠的小节（照抄 ST 的 .inline-drawer，只切 display）
 * @param {string} title
 * @param {boolean} open 默认展开？
 * @param {HTMLElement|HTMLElement[]} content
 * @returns {HTMLElement}
 */
function folder(title, open, content) {
    const wrap = el('div', 'cmcc-fold');

    const head = el('div', 'cmcc-fold-head' + (open ? '' : ' is-closed'));
    const chev = el('span', 'cmcc-fold-chev', open ? '▾' : '▸');
    head.appendChild(chev);
    head.appendChild(el('span', 'cmcc-fold-title', title));
    wrap.appendChild(head);

    const body = el('div', 'cmcc-fold-body');
    const items = Array.isArray(content) ? content : [content];
    for (const c of items) if (c) body.appendChild(c);
    body.style.display = open ? 'block' : 'none';
    wrap.appendChild(body);

    head.onclick = () => {
        const nowOpen = body.style.display === 'none';
        body.style.display = nowOpen ? 'block' : 'none';
        chev.textContent = nowOpen ? '▾' : '▸';
        head.classList.toggle('is-closed', !nowOpen);
    };
    return wrap;
}

// ══════════════════════════════════════════════
// 记忆树
// ══════════════════════════════════════════════

/**
 * 渲染一组记忆条目
 * @param {object} o
 * @param {string} o.wKey
 * @param {string} o.sKey
 * @param {Array} o.entries
 * @param {object} o.ctx
 * @param {object} o.api
 * @param {() => void} o.rerender
 */
function renderEntries({ wKey, sKey, entries, ctx, api, rerender }) {
    const ul = el('div', 'cmcc-entries');
    const SHOW = 30;
    const start = Math.max(0, (entries || []).length - SHOW);
    const selectMode = getSelectMode();

    (entries || []).slice(start).forEach((e, i) => {
        const idx = start + i;
        const row = el('div', 'cmcc-entry');
        row.appendChild(el('span', 'cmcc-lv cmcc-lv3', 'L3'));

        if (selectMode) {
            const val = entryKey(wKey, sKey, idx);
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'cmcc-check';
            cb.checked = SELECTED.has(val);
            cb.onclick = (ev) => ev.stopPropagation();
            cb.onchange = () => {
                if (cb.checked) SELECTED.add(val);
                else SELECTED.delete(val);
                rerender();
            };
            row.appendChild(cb);
            row.classList.add('cmcc-entry-sel');
            if (SELECTED.has(val)) row.classList.add('cmcc-picked');
            row.appendChild(el('span', 'cmcc-entry-text', e.text));
            row.onclick = () => {
                if (SELECTED.has(val)) SELECTED.delete(val);
                else SELECTED.add(val);
                rerender();
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
                rerender();
            }
        };
        row.appendChild(txt);
        const x = el('button', 'cmcc-x', '×');
        x.title = '删除这条';
        x.onclick = async () => {
            await api.deleteMemory(wKey, sKey, idx);
            rerender();
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

/** 「+ 加一条」 */
function makeAddRow({ wKey, sKey, prompt, ctx, api, rerender }) {
    const addRow = el('div', 'cmcc-add');
    const addBtn = el('button', 'menu_button cmcc-mini', '+ 加一条');
    addBtn.onclick = async () => {
        const v = await ctx.callGenericPopup(prompt || '新增一条记忆：', ctx.POPUP_TYPE.INPUT, '');
        if (v) { await api.addMemory(wKey, sKey, v); rerender(); }
    };
    addRow.appendChild(addBtn);
    return addRow;
}

/** 整棵记忆树 */
function buildMemoryTree({ ctx, api, rerender, snap, cur }) {
    const box = el('div', 'cmcc-mem-tree');

    if (!snap.stats.worlds.length) {
        box.appendChild(el('div', 'cmcc-empty', '还没有记忆，去玩一张卡就会开始记录。'));
        return box;
    }

    const selectMode = getSelectMode();

    for (const w of snap.stats.worlds.slice(0, 10)) {
        const card = el('div', 'cmcc-world' + (w.key === cur.wKey ? ' cmcc-cur' : ''));
        const wKeyId = 'w:' + w.key;
        const wCollapsed = isCollapsed(wKeyId);

        const wh = el('div', 'cmcc-world-head');
        wh.appendChild(el('span', 'cmcc-chev', wCollapsed ? '▸' : '▾'));

        if (selectMode) {
            const wcb = document.createElement('input');
            wcb.type = 'checkbox';
            wcb.className = 'cmcc-check cmcc-world-check';
            const st = worldSelState(w.key, snap.worlds);
            wcb.checked = st === 'all';
            wcb.indeterminate = st === 'some';
            wcb.title = '勾选整个世界（连同它下面所有存档与记忆）';
            wcb.onclick = (ev) => ev.stopPropagation();
            wcb.onchange = () => {
                if (wcb.checked) SELECTED_WORLDS.add(w.key);
                else SELECTED_WORLDS.delete(w.key);
                setWorldAll(w.key, wcb.checked, snap.worlds);
                rerender();
            };
            wh.appendChild(wcb);
            if (SELECTED_WORLDS.has(w.key)) card.classList.add('cmcc-picked');
        }

        wh.appendChild(el('span', 'cmcc-lv cmcc-lv1', 'L1'));
        wh.appendChild(el('span', 'cmcc-lvname', '世界'));
        const wt = el('span', 'cmcc-world-title', (w.key === cur.wKey ? '● ' : '') + w.label);
        wt.title = '点击改名';
        wt.onclick = async (ev) => {
            ev.stopPropagation();
            const v = await ctx.callGenericPopup('重命名这个世界：', ctx.POPUP_TYPE.INPUT, w.label);
            if (v) { await api.renameWorld(w.key, v); rerender(); }
        };
        wh.appendChild(wt);
        wh.appendChild(el('span', 'cmcc-meta', `${w.saveCount} 个存档 · ${w.count} 条记忆`));
        wh.appendChild(el('span', 'cmcc-curbadge', w.key === cur.wKey ? '当前位置' : ''));
        wh.onclick = () => { toggleCollapsed(wKeyId); rerender(); };
        wh.title = '点击展开 / 收起';
        card.appendChild(wh);

        if (!wCollapsed) {
            for (const s of w.saves) {
                const sKeyId = saveKeyId(w.key, s.key);
                const sCollapsed = isCollapsed(sKeyId);
                const sd = el('div', 'cmcc-save');
                const sh = el('div', 'cmcc-save-head');
                sh.appendChild(el('span', 'cmcc-chev', sCollapsed ? '▸' : '▾'));

                if (selectMode) {
                    const scb = document.createElement('input');
                    scb.type = 'checkbox';
                    scb.className = 'cmcc-check cmcc-save-check';
                    const st = saveSelState(w.key, s.key, snap.worlds);
                    scb.checked = st === 'all';
                    scb.indeterminate = st === 'some';
                    scb.title = '勾选这个存档（连同它下面全部记忆）';
                    scb.onclick = (ev) => ev.stopPropagation();
                    scb.onchange = () => {
                        if (scb.checked) SELECTED_SAVES.add(sKeyId);
                        else SELECTED_SAVES.delete(sKeyId);
                        setSaveEntries(w.key, s.key, scb.checked, snap.worlds);
                        rerender();
                    };
                    sh.appendChild(scb);
                }

                sh.appendChild(el('span', 'cmcc-lv cmcc-lv2', 'L2'));
                sh.appendChild(el('span', 'cmcc-lvname', '存档'));
                const stl = el('span', 'cmcc-save-title', s.label);
                stl.title = '点击改名';
                stl.onclick = async (ev) => {
                    ev.stopPropagation();
                    const v = await ctx.callGenericPopup('重命名这次经历：', ctx.POPUP_TYPE.INPUT, s.label);
                    if (v) { await api.renameSave(w.key, s.key, v); rerender(); }
                };
                sh.appendChild(stl);
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
                    if (ok) { await api.deleteSave(w.key, s.key); rerender(); }
                };
                sh.appendChild(del);
                sh.onclick = () => { toggleCollapsed(sKeyId); rerender(); };
                sh.title = '点击展开 / 收起';
                if (selectMode && SELECTED_SAVES.has(sKeyId)) sd.classList.add('cmcc-picked');
                sd.appendChild(sh);

                if (!sCollapsed) {
                    const entries = snap.worlds?.[w.key]?.saves?.[s.key]?.entries || [];
                    sd.appendChild(renderEntries({
                        wKey: w.key, sKey: s.key, entries, ctx, api, rerender,
                    }));
                    sd.appendChild(makeAddRow({
                        wKey: w.key, sKey: s.key, ctx, api, rerender,
                        prompt: '新增一条记忆：',
                    }));
                }
                card.appendChild(sd);
            }
        }
        box.appendChild(card);
    }
    return box;
}

// ══════════════════════════════════════════════
// 各标签页
// ══════════════════════════════════════════════

/** 陪伴角色 */
function tabCompanion({ ctx, api, snap, onOpenSettingsSection }) {
    const box = el('div', 'cmcc-tab-pane');

    // ── 当前是谁 ──
    const who = el('div', 'cmcc-top-who');
    who.appendChild(el('span', 'cmcc-top-who-name', snap.companionName || '（未设置）'));
    who.appendChild(el('span', 'cmcc-top-who-tag', snap.personaMode === 'builtin' ? '内置' : '角色卡'));
    box.appendChild(who);

    // ── 状态提示 ──
    if (!snap.hasCompanion) {
        box.appendChild(el('div', 'cmcc-warn',
            '还没有设好陪伴角色。去「人设」标签填一下，或者用一张已有的角色卡。'));
    } else if (snap.injectMemory) {
        box.appendChild(el('div', 'cmcc-ok',
            '记忆已直接注入 <b>不需要</b>挂载世界书。'));
    } else {
        const warn = el('div', 'cmcc-warn');
        warn.innerHTML = '记忆注入是关的 —— 她读不到记忆。'
            + '要么打开「注入记忆」，要么把世界书挂到当前聊天。';
        if (!isWorldBookActive(ctx, snap.bookName)) {
            const b = el('button', 'menu_button cmcc-mini', '去挂载');
            b.onclick = () => openWorldBook(ctx, snap.bookName);
            warn.appendChild(b);
        }
        box.appendChild(warn);
    }

    // ── 诊断 ──
    const diagRow = el('div', 'cmcc-btns');
    const bDiag = el('button', 'menu_button cmcc-mini', '诊断信息');
    bDiag.title = '把当前状态打到控制台，排查问题时用';
    bDiag.onclick = () => {
        const info = {
            陪伴角色: snap.companionName,
            来源: snap.personaMode,
            启用: snap.enabled,
            注入记忆: snap.injectMemory,
            同步世界书: snap.syncWorldbook,
            世界书: snap.bookName,
            世界书已挂载: isWorldBookActive(ctx, snap.bookName),
            当前位置: api.currentPos?.() || null,
            记忆规模: snap.stats,
        };
        console.log(LOG_TAG, '诊断信息', info);
        ctx.toastr?.info?.('已打到控制台（F12）', '诊断信息');
    };
    diagRow.appendChild(bDiag);

    const bSet = el('button', 'menu_button cmcc-mini', '去设置页');
    bSet.title = '切来源（内置 / 角色卡）、改参数、导入导出';
    bSet.onclick = () => onOpenSettingsSection?.();
    diagRow.appendChild(bSet);

    box.appendChild(folder('诊断与设置入口', false, diagRow));
    return box;
}

/** 人设 */
function tabPersona({ ctx, api, snap, rerender }) {
    const box = el('div', 'cmcc-tab-pane');

    const isBuiltin = snap.personaMode === 'builtin';

    const head = el('div', 'cmcc-tab-head');
    head.innerHTML = `来源：<b>${isBuiltin ? '内置人设' : '角色卡'}</b>`;
    const reloadP = el('button', 'menu_button cmcc-mini', '刷新');
    reloadP.onclick = () => rerender();
    head.appendChild(reloadP);
    box.appendChild(head);

    if (!isBuiltin) {
        // 角色卡模式：人设就是那张卡本身，插件不去改它 ——
        // 避免两处都能改、结果互相覆盖。
        const card = (ctx.characters || []).find((c) => c && c.avatar === snap.companionAvatar);
        box.appendChild(el('div', 'cmcc-hint',
            '当前用的是角色库里的一张卡'
            + (card ? `（<b>${card.name || card.avatar}</b>）` : '')
            + '。'))
        box.appendChild(el('div', 'cmcc-hint',
            '角色卡的人设请直接用酒馆的角色编辑器改 —— '
            + '这里不重复提供入口，免得两处都能改、改出不一致。'));
        return box;
    }

    const d = snap.builtin || {};
    const fields = [
        ['name', '名字', d.name || ''],
        ['description', '角色描述', d.description || ''],
        ['personality', '性格', d.personality || ''],
        ['scenario', '与你的关系', d.scenario || ''],
    ];

    for (const [key, label, val] of fields) {
        const row = el('div', 'cmcc-field');
        row.appendChild(el('label', 'cmcc-field-label', label));
        const txt = el('div', 'cmcc-field-val',
            (val || '（空）').slice(0, 200) + (val && val.length > 200 ? ' …' : ''));
        txt.title = '点击编辑';
        txt.onclick = async () => {
            const v = await ctx.callGenericPopup(`编辑「${label}」：`, ctx.POPUP_TYPE.INPUT, val);
            if (v != null && v !== val) {
                await api.editPersona(key, v);
                rerender();
            }
        };
        row.appendChild(txt);
        box.appendChild(row);
    }

    box.appendChild(el('div', 'cmcc-hint',
        '她是<b>独立</b>的：不写进角色卡库，也不依赖原生世界书。'
        + '多个人设预设的切换、导出导入 → 在「设置页」里。'));
    return box;
}

/** 记忆 */
function tabMemory({ ctx, api, snap, cur, rerender }) {
    const box = el('div', 'cmcc-tab-pane');

    // ── 顶部：规模 + 当前位置 ──
    const head = el('div', 'cmcc-tab-head');
    head.innerHTML = `<b>${snap.stats.worldCount}</b> 个世界 · `
        + `<b>${snap.stats.totalEntries}</b> 条记忆`;
    const reloadM = el('button', 'menu_button cmcc-mini', '重新载入');
    reloadM.title = '从世界书重新载入（你在世界书编辑器里手改过就用这个）';
    reloadM.onclick = async () => { await api.reload(); rerender(); };
    head.appendChild(reloadM);
    box.appendChild(head);

    box.appendChild(el('div', 'cmcc-now', `当前位置：<b>${cur.wLabel || '—'}</b>`));

    // ── 顶部按钮排（多选就在这一排里，不再单独折叠）──
    box.appendChild(makeMemoryTopBar({ ctx, api, snap, cur, rerender }));

    // ── 多选态下的提示 ──
    if (getSelectMode()) {
        box.appendChild(el('div', 'cmcc-hint',
            '已进入多选。下面每一行（世界 / 存档 / 记忆）都有勾选框，'
            + '<b>勾世界会连带它下面所有存档和记忆</b>。'));
    }

    // ── 记忆树 ──
    box.appendChild(buildMemoryTree({ ctx, api, rerender, snap, cur }));

    // ── 按范围删（这个保留折叠：破坏性操作，不该摆在明面上）──
    box.appendChild(folder('按范围删除', false, buildDangerZone({ ctx, api, cur, rerender })));

    return box;
}

/**
 * 「记忆」标签的顶部按钮排
 *
 * ★ 用户反馈「多选没必要单独收，应放在顶部即可」。
 *   原来多选是个独立的折叠小节，藏在记忆树下面 —— 要进多选得先展开它，
 *   很绕。现在它就是顶部那一排里的一个按钮。
 *
 * 两种状态：
 *   普通 —— [☑ 多选] [全部展开] [全部收起] [只看当前] [打开世界书]
 *   多选 —— [✕ 退出多选] 已选 N 条 [全选当前] [清空勾选] [删除选中的 N 项]
 */
function makeMemoryTopBar({ ctx, api, snap, cur, rerender }) {
    const row = el('div', 'cmcc-btns cmcc-mem-topbar');
    const selectMode = getSelectMode();

    /** 造一个按钮 */
    const mk = (label, fn, title, extraCls) => {
        const b = el('button', 'menu_button cmcc-mini' + (extraCls ? ' ' + extraCls : ''), label);
        if (title) b.title = title;
        b.onclick = fn;
        return b;
    };

    // ── 进 / 出多选（普通态下它是主按钮，好找）──
    row.appendChild(mk(
        selectMode ? '✕ 退出多选' : '☑ 多选',
        () => {
            setSelectMode(!getSelectMode());
            if (!getSelectMode()) clearSelection();
            rerender();
        },
        selectMode ? '退出多选模式' : '勾选多条记忆一起删',
        selectMode ? '' : 'cmcc-primary-btn',
    ));

    // ══════════════════════════════════════════
    // 多选态：只留和勾选有关的操作
    // ══════════════════════════════════════════
    if (selectMode) {
        const wN = SELECTED_WORLDS.size;
        const sN = SELECTED_SAVES.size;
        row.appendChild(el('span', 'cmcc-meta',
            `已选 ${SELECTED.size} 条`
            + (sN ? ` + ${sN} 个存档` : '')
            + (wN ? ` + ${wN} 个世界` : '')));

        row.appendChild(mk('全选当前', () => {
            for (const w of snap.stats.worlds) {
                for (const s of w.saves) {
                    const arr = snap.worlds?.[w.key]?.saves?.[s.key]?.entries || [];
                    arr.forEach((_, i) => SELECTED.add(entryKey(w.key, s.key, i)));
                }
            }
            rerender();
        }, '勾选当前世界里的全部记忆'));

        row.appendChild(mk('清空勾选', () => { clearSelection(); rerender(); }));

        const total = selectedTotal();
        const bDel = mk(
            (sN || wN) ? `删除选中的 ${total} 项` : `删除选中的 ${SELECTED.size} 条`,
            async () => {
                if (!total) return;
                const desc = [
                    SELECTED.size ? `${SELECTED.size} 条记忆` : '',
                    sN ? `${sN} 个存档（含其全部记忆）` : '',
                    wN ? `${wN} 个世界（含其全部存档）` : '',
                ].filter(Boolean).join(' + ');
                const ok = await ctx.callGenericPopup(
                    `确定删除 ${desc}？此操作不可撤销。`, ctx.POPUP_TYPE.CONFIRM);
                if (!ok) return;

                let n = 0;
                // 顺序有讲究：先整世界 → 再整存档 → 最后零散记忆。
                // 后两步都要跳过已被删掉的部分，否则条目下标会错位、删错东西。
                const deadWorlds = new Set(SELECTED_WORLDS);
                for (const wk of deadWorlds) {
                    const r = await api.deleteByScope('currentWorld', wk);
                    n += r.deleted;
                }
                const deadSaves = new Set();
                for (const k of SELECTED_SAVES) {
                    const parts = k.split('\u0000');
                    const w = parts[0], sk = parts[1];
                    if (deadWorlds.has(w)) continue;
                    deadSaves.add(k);
                    const r = await api.deleteByScope('save', w, sk);
                    n += r.deleted;
                }
                const groups = new Map();
                for (const k of SELECTED) {
                    const [w, sk, i] = parseEntryKey(k);
                    if (deadWorlds.has(w)) continue;
                    if (deadSaves.has(w + '\u0000' + sk)) continue;
                    const gk = w + '\u0000' + sk;
                    if (!groups.has(gk)) groups.set(gk, { w, s: sk, idx: [] });
                    groups.get(gk).idx.push(i);
                }
                for (const g of groups.values()) {
                    n += await api.deleteMemories(g.w, g.s, g.idx);
                }

                const extra = [
                    deadSaves.size ? `${deadSaves.size} 个存档` : '',
                    deadWorlds.size ? `${deadWorlds.size} 个世界` : '',
                ].filter(Boolean).join(' + ');
                clearSelection();
                ctx.toastr?.success?.(`已删除 ${n} 条记忆` + (extra ? `（含 ${extra}）` : ''));
                rerender();
            },
            '', 'cmcc-danger',
        );
        bDel.disabled = total === 0;
        bDel.classList.add('cmcc-del-btn');
        row.appendChild(bDel);

        return row;
    }

    // ══════════════════════════════════════════
    // 普通态：视图操作
    // ══════════════════════════════════════════
    row.appendChild(mk('全部展开', () => { clearCollapsed(); rerender(); },
        '展开所有世界与存档'));

    row.appendChild(mk('全部收起', () => {
        const keys = [];
        for (const w of snap.stats.worlds) {
            keys.push('w:' + w.key);
            for (const s of w.saves) keys.push(saveKeyId(w.key, s.key));
        }
        collapseAll(keys);
        rerender();
    }, '收起所有世界与存档'));

    row.appendChild(mk('只看当前', () => {
        clearCollapsed();
        const keys = [];
        for (const w of snap.stats.worlds) {
            if (w.key !== cur.wKey) keys.push('w:' + w.key);
            for (const s of w.saves) {
                if (w.key !== cur.wKey || s.key !== cur.sKey) {
                    keys.push(saveKeyId(w.key, s.key));
                }
            }
        }
        collapseAll(keys);
        rerender();
    }, '只展开当前世界与当前存档'));

    row.appendChild(mk('打开世界书', () => openWorldBook(ctx, snap.bookName),
        '用酒馆自己的编辑器改记忆（适合批量改）'));

    return row;
}

/** 按范围删除 */
function buildDangerZone({ ctx, api, cur, rerender }) {
    const box = el('div', 'cmcc-danger-box');
    const row1 = el('div', 'cmcc-btns');
    const row2 = el('div', 'cmcc-btns');

    const mk = (label, scope, what) => {
        const b = el('button', 'menu_button cmcc-mini cmcc-danger', label);
        b.title = '删除：' + what;
        b.onclick = async () => {
            const ok = await ctx.callGenericPopup(
                `确定删除「${what}」的<b>全部</b>记忆？此操作不可撤销。`,
                ctx.POPUP_TYPE.CONFIRM);
            if (!ok) return;
            const r = await api.deleteByScope(scope);
            clearSelection();
            ctx.toastr?.success?.(`已删除 ${r.deleted} 条（${r.what}）`);
            rerender();
        };
        return b;
    };

    row1.appendChild(mk('清空本次存档', 'save', `${cur.wLabel || '当前世界'} / 本次`));
    row2.appendChild(mk('清空共同记忆', 'shared', '跨所有世界的共同记忆'));
    row2.appendChild(mk('删除整个世界', 'currentWorld',
        `${cur.wLabel || '当前世界'}（含全部存档）`));

    box.appendChild(row1);
    box.appendChild(row2);
    box.appendChild(el('div', 'cmcc-hint',
        '这些只删记忆，不会删你的聊天记录。删错了可以用酒馆的世界书编辑器手动补回来。'));
    return box;
}

// ══════════════════════════════════════════════
// 关于（手动更新 + 爱发电）
// ══════════════════════════════════════════════

/**
 * 手动更新自己
 *
 * 走 ST 自己的接口 POST /api/extensions/update（已核对 ST 源码
 * src/endpoints/extensions.js:169）。
 *   · 参数：{ extensionName, global }
 *   · 返回：{ shortCommitHash, extensionPath, isUpToDate, remoteUrl }
 *   · **即使已是最新也返回 200**，要看 data.isUpToDate 区分
 *   · 需要 CSRF token —— 用 ST 的 getRequestHeaders()
 *
 * ⚠ ST 没有导出任何"更新扩展"的函数（updateExtension 是模块私有的），
 *   所以只能自己 fetch。这是本机 JS-Slash-Runner 扩展的同款做法。
 */
async function doSelfUpdate(ctx, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '更新中…';

    try {
        const headers = (typeof getRequestHeaders === 'function')
            ? getRequestHeaders()
            : { 'Content-Type': 'application/json' };

        const resp = await fetch('/api/extensions/update', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                extensionName: EXTENSION_FOLDER,
                global: false,
            }),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} ${text || resp.statusText}`.trim());
        }

        const data = await resp.json();

        if (data.isUpToDate) {
            ctx.toastr?.info?.('已经是最新版了', 'CMCC');
        } else {
            ctx.toastr?.success?.(
                `已更新到 ${data.shortCommitHash} —— 正在重新加载页面…`, 'CMCC');
            // 更新会把正在运行的代码换掉，必须重载才能生效
            // （ST 官方也是这么提示的：Reload the page to apply updates）
            setTimeout(() => { try { location.reload(); } catch (e) { /* ignore */ } }, 1200);
        }
    } catch (e) {
        console.error(LOG_TAG, '更新失败', e);
        ctx.toastr?.error?.(`更新失败：${e.message}`, 'CMCC');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/** 查有没有新版本（不更新） */
async function checkUpdate(ctx, out) {
    out.textContent = '检查中…';
    try {
        const headers = (typeof getRequestHeaders === 'function')
            ? getRequestHeaders()
            : { 'Content-Type': 'application/json' };
        const resp = await fetch('/api/extensions/version', {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionName: EXTENSION_FOLDER, global: false }),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const d = await resp.json();
        if (d.isUpToDate) {
            out.textContent = `已是最新（${(d.currentCommitHash || '').slice(0, 7)}）`;
        } else {
            out.textContent = `有新版本！当前 ${(d.currentCommitHash || '').slice(0, 7)}`;
            out.classList.add('cmcc-update-avail');
        }
    } catch (e) {
        out.textContent = '检查失败：' + e.message;
    }
}

function tabAbout({ ctx, version }) {
    const box = el('div', 'cmcc-tab-pane');

    // ── 更新 ──
    const updRow = el('div', 'cmcc-about-row');
    const info = el('div', 'cmcc-about-info');
    info.innerHTML = `<b>跨世界陪伴角色 (CMCC)</b><br>`
        + `<span class="cmcc-hint">当前版本 ${version || '—'}</span>`;
    updRow.appendChild(info);

    const statusLine = el('div', 'cmcc-hint cmcc-update-status', '');
    const btnRow = el('div', 'cmcc-btns');
    const bCheck = el('button', 'menu_button cmcc-mini', '检查更新');
    bCheck.onclick = () => checkUpdate(ctx, statusLine);
    btnRow.appendChild(bCheck);

    const bUpd = el('button', 'menu_button cmcc-mini', '立即更新');
    bUpd.title = '从 GitHub 拉取最新版；更新完会自动重新加载页面';
    bUpd.onclick = () => doSelfUpdate(ctx, bUpd);
    btnRow.appendChild(bUpd);

    box.appendChild(folder('更新', true, [updRow, btnRow, statusLine]));

    // ── 备份 ──
    // ⚠ 只能备份**插件自己的**东西（人设 + 记忆）。
    //   聊天记录、角色卡、预设、以及 ST 的 settings.json 都归酒馆管，
    //   浏览器里的扩展没有权限碰它们 —— 那些必须用磁盘上的脚本备份。
    const bkRow = el('div', 'cmcc-about-info');
    bkRow.innerHTML = '<b>备份人设与记忆</b><br>'
        + '<span class="cmcc-hint">导出一个 JSON，含当前人设和全部记忆。</span>';
    const bkBtns = el('div', 'cmcc-btns');

    const bBk = el('button', 'menu_button cmcc-mini', '导出备份');
    bBk.title = '把当前人设 + 全部记忆存成一个 JSON 文件';
    bBk.onclick = async () => {
        try {
            const data = await api.exportAll();
            data._backupAt = new Date().toISOString();
            data._note = 'CMCC 的人设 + 记忆备份。用「导入」按钮还原。';

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const nm = ((data.persona && data.persona.name) || 'CMCC').replace(/[\\/:*?"<>|]/g, '_');
            a.href = url;
            a.download = `CMCC-backup-${nm}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 3000);

            let n = 0;
            for (const w of Object.values(data.worlds || {})) {
                for (const s of Object.values(w.saves || {})) n += (s.entries || []).length;
            }
            ctx.toastr?.success?.(`已导出：人设 + ${n} 条记忆`, 'CMCC');
        } catch (e) {
            console.error(LOG_TAG, '备份失败', e);
            ctx.toastr?.error?.('备份失败：' + e.message, 'CMCC');
        }
    };
    bkBtns.appendChild(bBk);

    const bImp = el('button', 'menu_button cmcc-mini', '从备份还原');
    bImp.title = '载入之前导出的 JSON（记忆按内容去重，不覆盖）';
    bImp.onclick = () => ctx.toastr?.info?.('去「设置页 → 导入」选文件即可', 'CMCC');
    bkBtns.appendChild(bImp);

    box.appendChild(folder('备份', true, [bkRow, bkBtns]));

    box.appendChild(el('div', 'cmcc-hint',
        '⚠ 这里的备份<b>只含插件自己的人设和记忆</b>。'
        + '聊天记录、角色卡、预设、酒馆设置都归酒馆管，浏览器里的扩展读不到它们 ——'
        + '那些要用仓库里的 <code>tools/restore-backup.ps1</code> 在磁盘上备份。'));

    // ── 支持作者 ──
    const supRow = el('div', 'cmcc-about-row');
    const supTxt = el('div', 'cmcc-about-info');
    supTxt.innerHTML = '<b>如果它帮到你了</b><br>'
        + '<span class="cmcc-hint">完全自愿，不影响任何功能。</span>';
    supRow.appendChild(supTxt);

    const bAfd = el('a', 'menu_button cmcc-support-btn');
    bAfd.href = AFDIAN_URL;
    bAfd.target = '_blank';
    bAfd.rel = 'noopener noreferrer';
    bAfd.title = '在爱发电支持作者（新标签页打开）';
    bAfd.innerHTML = '<span class="cmcc-support-ico">♥</span> 爱发电赞助';
    supRow.appendChild(bAfd);
    box.appendChild(folder('支持作者', true, supRow));

    // ── 链接 ──
    const linkRow = el('div', 'cmcc-btns');
    const bHome = el('a', 'menu_button cmcc-mini');
    bHome.href = 'https://github.com/WhiteShawqi/SillyTavern-CMCC';
    bHome.target = '_blank';
    bHome.rel = 'noopener noreferrer';
    bHome.textContent = '项目主页';
    linkRow.appendChild(bHome);

    const bIssue = el('a', 'menu_button cmcc-mini');
    bIssue.href = 'https://github.com/WhiteShawqi/SillyTavern-CMCC/issues';
    bIssue.target = '_blank';
    bIssue.rel = 'noopener noreferrer';
    bIssue.textContent = '反馈问题';
    linkRow.appendChild(bIssue);
    box.appendChild(folder('链接', false, linkRow));

    return box;
}

// ══════════════════════════════════════════════
// 弹出面板
// ══════════════════════════════════════════════

/**
 * 构建编辑器元素（**不弹窗**）
 *
 * 拆出来是为了浏览器验证：验证页没法调 ctx.callGenericPopup，
 * 但可以直接把 buildEditor() 的结果挂到页面上，看真实布局。
 *
 * @param {object} o
 * @param {object} o.ctx
 * @param {object} o.api         index.js 暴露的操作
 * @param {string} [o.version]   当前版本号，显示在「关于」里
 * @returns {HTMLElement}
 */
export function buildEditor({ ctx, api, version }) {
    // 弹出窗口的根
    const root = el('div', 'cmcc-editor');

    // ── 标签栏 ──
    const tabBar = el('div', 'cmcc-tabs');
    const panes = el('div', 'cmcc-panes');
    root.appendChild(tabBar);
    root.appendChild(panes);

    /** 重新渲染当前标签页（内容变化时调这个） */
    function rerender() {
        renderActive();
    }

    function renderActive() {
        // 标签按钮状态
        [...tabBar.children].forEach((b) => {
            b.classList.toggle('is-active', b.dataset.tab === ACTIVE_TAB);
        });

        panes.innerHTML = '';

        let snap;
        try { snap = api.snapshot(); } catch (e) {
            panes.appendChild(el('div', 'cmcc-empty',
                '读取失败：' + String(e && e.message || e)));
            return;
        }
        let cur = { wKey: '', sKey: '', wLabel: '' };
        try { cur = api.currentPos(); } catch (e) { /* ignore */ }

        const args = { ctx, api, snap, cur, rerender, version };
        let pane = null;
        try {
            if (ACTIVE_TAB === 'companion') {
                pane = tabCompanion({
                    ctx, api, snap,
                    onOpenSettingsSection: () => {
                        // 关掉弹窗，回到设置页（用户要看参数 / 导出入）
                        try { document.querySelector('#cmcc-editor-popup .popup-button-ok')?.click(); } catch (e) { /* ignore */ }
                    },
                });
            } else if (ACTIVE_TAB === 'persona') {
                pane = tabPersona(args);
            } else if (ACTIVE_TAB === 'memory') {
                pane = tabMemory(args);
            } else {
                pane = tabAbout({ ctx, version });
            }
        } catch (e) {
            console.error(LOG_TAG, '渲染标签页失败', ACTIVE_TAB, e);
            pane = el('div', 'cmcc-empty', '这个标签页渲染失败了：' + (e && e.message));
        }
        panes.appendChild(pane);
    }

    for (const t of TABS) {
        const b = el('button', 'cmcc-tab', t.label);
        b.dataset.tab = t.id;
        if (t.id === ACTIVE_TAB) b.classList.add('is-active');
        b.onclick = () => { ACTIVE_TAB = t.id; renderActive(); };
        tabBar.appendChild(b);
    }

    renderActive();

    // 把重渲染挂到根元素上，供外部（index.js）在记忆变化后刷新已打开的编辑器。
    // 用挂在 DOM 上的引用而不是模块级变量 —— 这样同一页多开也只认当前那个，
    // 而且弹窗被关掉、元素被丢弃时不会留下悬空引用。
    root.cmccRefresh = renderActive;

    return root;
}

/**
 * 打开编辑器（弹窗）
 *
 * @param {object} o
 * @param {object} o.ctx
 * @param {object} o.api
 * @param {string} [o.version]
 */
export function openEditor({ ctx, api, version }) {
    const root = buildEditor({ ctx, api, version });

    // 用 ST 的弹窗承载（TEXT 类型可以装任意内容）
    // 自己的 id 便于测试和调试定位
    root.id = 'cmcc-editor-popup';
    ctx.callGenericPopup(root, ctx.POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: '关闭',
        allowVerticalScrolling: true,
    });
}

/**
 * 刷新已经打开的编辑器（没打开就什么都不做）
 *
 * 为什么需要：记忆被改了之后（比如自动整理、或另一处删了条目），
 * 弹窗里显示的还是旧内容。
 */
export function refreshEditor() {
    const root = document.getElementById('cmcc-editor-popup');
    if (root && typeof root.cmccRefresh === 'function') {
        try {
            root.cmccRefresh();
        } catch (e) {
            console.warn(LOG_TAG, '刷新编辑器失败', e);
        }
    }
}

/** 供测试与调试 */
export { TABS, folder as __folder };

/** 仅供测试/调试：预置当前标签页 */
export function __setActiveTab(id) {
    if (TABS.some((t) => t.id === id)) ACTIVE_TAB = id;
}
