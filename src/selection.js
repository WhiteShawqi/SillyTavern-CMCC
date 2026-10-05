/**
 * CMCC · 记忆树 / 多选的共享状态与纯逻辑
 *
 * 抽出来的原因：这一段原来在 topbar.js 里，而顶部入口要搬到
 * 「弹出式编辑器」，两个界面都要用同一份状态 ——
 * 各复制一份的话，在 A 里勾选的条目到 B 里就看不见了。
 *
 * 这里只有状态和纯函数，不碰 DOM。
 */

// ══════════════════════════════════════════════
// 折叠状态
// ══════════════════════════════════════════════

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

export function isCollapsed(key) { return COLLAPSED.has(key); }

export function toggleCollapsed(key) {
    if (COLLAPSED.has(key)) COLLAPSED.delete(key);
    else COLLAPSED.add(key);
}

/** 展开某个键 */
export function expandKey(key) { COLLAPSED.delete(key); }

export function collapseAll(keys) {
    for (const k of keys) COLLAPSED.add(k);
}

export function clearCollapsed() { COLLAPSED.clear(); }

export { COLLAPSED };

// ══════════════════════════════════════════════
// 多选状态
// ══════════════════════════════════════════════

/** 是否处于多选模式 */
let SELECT_MODE = false;
/** 已勾选的记忆，键形如 'w\u0000s\u00003'（世界+存档+下标），跨存档全局唯一 */
const SELECTED = new Set();
/** 已勾选的整个世界（世界 key），删的时候整个一起删 */
const SELECTED_WORLDS = new Set();
/** 已勾选的整个存档，键形如 'w\u0000s' */
const SELECTED_SAVES = new Set();

export function getSelectMode() { return SELECT_MODE; }
export function setSelectMode(v) { SELECT_MODE = !!v; }
export function clearSelection() {
    SELECTED.clear(); SELECTED_SAVES.clear(); SELECTED_WORLDS.clear();
}

export { SELECTED, SELECTED_WORLDS, SELECTED_SAVES };

/** 组合一条记忆的唯一键 */
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

// ══════════════════════════════════════════════
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
// ══════════════════════════════════════════════

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

/** 已勾选总数（含世界与存档作为一个"项"） */
export function selectedTotal() {
    return SELECTED.size + SELECTED_SAVES.size + SELECTED_WORLDS.size;
}

/**
 * 仅供测试：暴露集合与开关。
 * 生产代码不要用。
 * @internal
 */
export const __selTestHook = {
    SELECTED, SELECTED_SAVES, SELECTED_WORLDS,
    clear() { clearSelection(); },
    setMode(v) { setSelectMode(v); },
    getMode() { return SELECT_MODE; },
};
