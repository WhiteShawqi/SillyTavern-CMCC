/**
 * 跨世界陪伴角色 (CMCC) · 状态与记忆模型（纯逻辑，无持久化）
 *
 * 持久化交给 src/store.js（世界书）。
 * 本模块只负责：设置、标识、以及在"世界书内容"上的增删改查。
 */

export const MODULE = 'ConstantCompanion';
export const APP_NAME = '跨世界陪伴角色';
export const APP_ABBR = 'CMCC';
export const APP_TAG = 'STCMCC';

/** 默认设置 */
export const DEFAULT_SETTINGS = {
    enabled: false,

    /**
     * 陪伴角色来源
     *   'builtin' —— 内置（默认）：人设存在扩展设置里，不注册进角色卡库，
     *                完全独立于原生角色卡与原生世界书
     *   'card'    —— 用角色库里已有的卡
     */
    personaMode: 'builtin',

    /** 内置人设（personaMode==='builtin' 时使用） */
    builtin: {
        name: '同伴',
        description: '',
        personality: '',
        scenario: '',
    },

    /** personaMode==='card' 时，指向角色卡文件名（avatar） */
    companionAvatar: '',

    /** 记忆直接注入提示词（不依赖世界书挂载） */
    injectMemory: true,
    /** 「最近」注入多少条（用户要求 5~10） */
    recentMemoryLimit: 8,
    /** 「相似旧事」注入多少条（用户要求 2~5） */
    relevantMemoryLimit: 4,
    /** 记忆注入的 token 预算 */
    memoryBudget: 1800,
    /** 引导文本的 token 预算 */
    tokenBudget: 600,
    /** 每个存档最多注入多少条记忆 */
    saveMemoryLimit: 500,
    /** 自动整理：每多少条消息一次 */
    summarizeEvery: 12,
    /** 自动整理冷却（秒） */
    summarizeCooldown: 90,
    /** 换存档/换世界时，让她自然表现出"这是另一次经历" */
    announceSaveSwitch: true,
    /** 读取 AI 正文里的 `cmcc 记忆块（MVU 式自动记记忆） */
    readMemoryCommands: true,
    /** 是否同步写一份世界书（便于用 ST 编辑器查看/编辑） */
    syncWorldbook: true,
    /** 调试输出 */
    debug: false,
};

/** 兼容旧设置：补齐新增字段 */
export function normalizeSettings(s) {
    const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
    out.builtin = Object.assign({}, DEFAULT_SETTINGS.builtin, s?.builtin || {});
    return out;
}

// ─────────────────────────────────────────────
// 标识
// ─────────────────────────────────────────────

export function worldKey(c) {
    try {
        if (c.groupId) return 'group:' + c.groupId;
        if (c.avatar) return 'char:' + c.avatar;
    } catch (e) { /* ignore */ }
    return 'unknown';
}

export function worldLabel(c) {
    try {
        if (c.groupId && Array.isArray(c.groups)) {
            const g = c.groups.find((x) => x.id === c.groupId);
            if (g && g.name) return g.name;
        }
        if (c.charName) return c.charName;
    } catch (e) { /* ignore */ }
    return '未知世界';
}

/**
 * 由聊天 ID 得到存档键
 *
 * ⚠ 返回 null 表示「当前没有有效聊天」——调用方必须**放弃记录**。
 *   曾经这里返回 'default'，于是没有聊天时也会建一个叫 'default' 的
 *   持久化存档；等聊天真正建好、ID 变了，又建一个 —— 结果就是
 *   「没切存档却冒出一堆存档」（用户报的 bug）。
 */
export function saveKey(chatId) {
    const id = String(chatId == null ? '' : chatId).trim();
    return id ? id : null;
}

// ─────────────────────────────────────────────
// 内存模型（对应世界书里一个世界的词条）
// ─────────────────────────────────────────────

/** 空世界模型 */
export function emptyWorld(label) {
    return { label: label || '未知世界', firstSeen: Date.now(), lastSeen: Date.now(), saves: {} };
}

/**
 * 确保存档存在
 * @returns {{save:object, isNew:boolean}}
 */
export function ensureSave(world, sKey, sLabel) {
    if (!world.saves) world.saves = {};
    let isNew = false;
    if (!world.saves[sKey]) {
        const n = Object.keys(world.saves).length + 1;
        world.saves[sKey] = {
            label: sLabel || `存档${n}`,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            entries: [],
        };
        isNew = true;
    } else {
        if (sLabel) world.saves[sKey].label = sLabel;
        world.saves[sKey].lastSeen = Date.now();
    }
    world.lastSeen = Date.now();
    return { save: world.saves[sKey], isNew };
}

/** 追加一条记忆 */
export function addMemory(world, sKey, text, kind = 'auto') {
    if (!text || !text.trim()) return null;
    const { save } = ensureSave(world, sKey);
    save.entries.push({ ts: Date.now(), text: text.trim(), kind });
    return save;
}

/** 改一条记忆 */
export function editMemory(world, sKey, index, text) {
    const s = world.saves?.[sKey];
    if (!s || !s.entries[index]) return false;
    s.entries[index].text = String(text || '').trim();
    s.entries[index].kind = 'manual';
    return true;
}

/** 删一条记忆 */
export function deleteMemory(world, sKey, index) {
    const s = world.saves?.[sKey];
    if (!s || !s.entries[index]) return false;
    s.entries.splice(index, 1);
    return true;
}

/**
 * 批量删一个存档里的多条记忆
 * @param {object} world
 * @param {string} sKey
 * @param {number[]} indexes
 * @returns {number} 实际删掉的条数
 */
export function deleteMemories(world, sKey, indexes) {
    const s = world?.saves?.[sKey];
    if (!s || !Array.isArray(s.entries) || !Array.isArray(indexes) || !indexes.length) return 0;
    // 去重 + 越界过滤 + 从后往前删（避免下标位移）
    const uniq = [...new Set(indexes)]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < s.entries.length)
        .sort((a, b) => b - a);
    for (const i of uniq) s.entries.splice(i, 1);
    return uniq.length;
}

/**
 * 按范围清空记忆（纯逻辑，只动传进来的数据结构）
 * @param {object} worlds 整个 worlds 容器（会被修改）
 * @param {'save'|'world'|'shared'|'currentWorld'} scope
 * @param {{wKey:string, sKey:string, wLabel?:string}} pos
 * @returns {{deleted:number, what:string}}
 */
export function clearByScope(worlds, scope, pos) {
    let deleted = 0;
    let what = '';
    const w = worlds?.[pos?.wKey];

    if (scope === 'shared') {
        const arr = worlds?.__shared__?.saves?.common?.entries;
        deleted = arr?.length || 0;
        if (worlds?.__shared__?.saves) delete worlds.__shared__.saves.common;
        what = '共同记忆';
    } else if (scope === 'world') {
        const arr = w?.saves?.[WORLDBOOK_CHANNEL]?.entries;
        deleted = arr?.length || 0;
        if (w?.saves?.[WORLDBOOK_CHANNEL]) delete w.saves[WORLDBOOK_CHANNEL];
        what = (pos?.wLabel || '当前世界') + ' 的世界级记忆';
    } else if (scope === 'save') {
        const save = w?.saves?.[pos?.sKey];
        deleted = save?.entries?.length || 0;
        if (save) save.entries = [];
        what = (pos?.wLabel || '当前世界') + ' / 本次';
    } else if (scope === 'currentWorld') {
        if (w) {
            for (const s of Object.values(w.saves || {})) {
                deleted += (s.entries || []).length;
            }
            delete worlds[pos.wKey];
        }
        what = (pos?.wLabel || '当前世界') + '（整个世界）';
    }
    return { deleted, what };
}

/**
 * 收掉空存档 / 空世界（纯逻辑）
 * @returns {{saves:number, worlds:number}}
 */
export function purgeEmpty(worlds) {
    let saves = 0, worlds_n = 0;
    for (const [wk, w] of Object.entries(worlds || {})) {
        if (!w?.saves) { delete worlds[wk]; worlds_n++; continue; }
        for (const [sk, s] of Object.entries(w.saves)) {
            if (!(s.entries || []).length) { delete w.saves[sk]; saves++; }
        }
        if (!Object.keys(w.saves).length) { delete worlds[wk]; worlds_n++; }
    }
    return { saves, worlds: worlds_n };
}

/** 重命名存档 */
export function renameSave(world, sKey, name) {
    const s = world.saves?.[sKey];
    if (!s) return false;
    s.label = String(name || '').trim() || s.label;
    return true;
}

/** 删除存档 */
export function deleteSave(world, sKey) {
    if (!world.saves?.[sKey]) return false;
    delete world.saves[sKey];
    return true;
}

/** 重命名世界（同时改世界书词条名由调用方处理） */
export function renameWorld(world, label) {
    world.label = String(label || '').trim() || world.label;
    return true;
}

// ─────────────────────────────────────────────
// 统计
// ─────────────────────────────────────────────

/**
 * 世界级记忆的容器通道名（world.saves['__world__']）
 * ⚠ 与 inject.js 的 WORLDBOOK_CHANNEL 必须一致。
 *   这里不 import 是为了让 state.js 保持零依赖（纯逻辑，便于测试）。
 */
export const WORLDBOOK_CHANNEL = '__world__';

export function worldStats(world) {
    // 世界通道不是一个「存档」，统计里要排除，但它的条目数要算进这个世界
    const all = Object.entries(world?.saves || {});
    const saves = all.filter(([k]) => k !== WORLDBOOK_CHANNEL);
    const worldEntries = world?.saves?.[WORLDBOOK_CHANNEL]?.entries || [];
    const count = all.reduce((a, [, s]) => a + (s.entries || []).length, 0);
    return {
        label: world?.label || '未知世界',
        saveCount: saves.length,
        count,
        worldEntryCount: worldEntries.length,
        lastSeen: world?.lastSeen || 0,
        saves: saves.map(([k, s]) => ({
            key: k, label: s.label, count: (s.entries || []).length,
            lastSeen: s.lastSeen || 0,
        })).sort((a, b) => b.lastSeen - a.lastSeen),
    };
}

/** 所有世界的汇总统计（排除 __shared__ 这类内部容器） */
export function bookStats(worlds) {
    const list = Object.entries(worlds || {})
        .filter(([k]) => !k.startsWith('__'))
        .map(([k, w]) => ({ key: k, ...worldStats(w) }));
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    const shared = worlds?.__shared__?.saves?.common?.entries || [];
    return {
        worldCount: list.length,
        totalEntries: list.reduce((a, x) => a + x.count, 0),
        sharedCount: shared.length,
        worlds: list,
    };
}

// ─────────────────────────────────────────────
// 迁移：旧的 localStorage 记忆 → 内存模型
// ─────────────────────────────────────────────

export function migrateFromLocalStorage() {
    try {
        const rawV2 = localStorage.getItem('cc_memory_v2');
        const rawV1 = localStorage.getItem('cc_memory_v1');
        const raw = rawV2 || rawV1;
        if (!raw) return null;
        const old = JSON.parse(raw);
        const companionAvatar = old.companionAvatar || '';
        const worlds = {};

        // 判别 v1 / v2：v2 的 worlds[*] 下是 saves；v1 的 worlds[*] 下直接是 entries
        const isV2 = old.version === 2
            || Object.values(old.worlds || {}).some((x) => x && x.saves);

        if (isV2) {
            for (const [k, w] of Object.entries(old.worlds || {})) {
                if (k === '__shared__') continue;
                const world = emptyWorld(w.label);
                world.firstSeen = w.firstSeen || Date.now();
                world.lastSeen = w.lastSeen || Date.now();
                for (const [sk, s] of Object.entries(w.saves || {})) {
                    world.saves[sk] = {
                        label: s.label || '存档1',
                        firstSeen: s.firstSeen || Date.now(),
                        lastSeen: s.lastSeen || Date.now(),
                        entries: (s.entries || []).map((x) => ({
                            ts: x.ts || Date.now(), text: x.text, kind: x.kind || 'auto',
                        })),
                    };
                }
                worlds[k] = world;
            }
        } else {
            // v1：worlds + meta
            for (const [k, w] of Object.entries(old.worlds || {})) {
                const world = emptyWorld(w.label);
                world.saves.legacy = {
                    label: '存档1',
                    firstSeen: w.firstSeen || Date.now(),
                    lastSeen: w.lastSeen || Date.now(),
                    entries: (w.entries || []).map((x) => ({
                        ts: x.ts || Date.now(), text: x.text, kind: x.kind || 'auto',
                    })),
                };
                worlds[k] = world;
            }
        }

        // 共同记忆
        let shared = [];
        if (Array.isArray(old.meta)) {
            shared = old.meta.map((x) => ({ ts: x.ts || Date.now(), text: x.text, kind: 'bond' }));
        }
        if (old.worlds?.__shared__?.saves?.common?.entries) {
            shared = old.worlds.__shared__.saves.common.entries;
        }

        return { companionAvatar, worlds, shared, hadLegacy: true };
    } catch (e) {
        console.warn('[CMCC] 旧记忆迁移失败', e);
        return null;
    }
}

/** 迁移完成后清掉旧键 */
export function clearLegacyKeys() {
    try {
        localStorage.removeItem('cc_memory_v2');
        localStorage.removeItem('cc_memory_v1');
    } catch (e) { /* ignore */ }
}
