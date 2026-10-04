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
    /** 陪伴的角色卡文件名（avatar），空串=未选择 */
    companionAvatar: '',
    /** 动态注入「你在哪 / 怎么用这些记忆」的引导（记忆本身由世界书注入） */
    dynamicGuide: true,
    /** 引导文本的 token 预算 */
    tokenBudget: 600,
    /** 每个存档最多写入多少条记忆 */
    saveMemoryLimit: 500,
    /** 自动整理：每多少条消息一次 */
    summarizeEvery: 12,
    /** 自动整理冷却（秒） */
    summarizeCooldown: 90,
    /** 换存档/换世界时，让她自然表现出"这是另一次经历" */
    announceSaveSwitch: true,
    /** 调试输出 */
    debug: false,
};

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

export function saveKey(chatId) {
    return chatId ? String(chatId) : 'default';
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

export function worldStats(world) {
    const saves = Object.entries(world?.saves || {});
    const count = saves.reduce((a, [, s]) => a + (s.entries || []).length, 0);
    return {
        label: world?.label || '未知世界',
        saveCount: saves.length,
        count,
        lastSeen: world?.lastSeen || 0,
        saves: saves.map(([k, s]) => ({
            key: k, label: s.label, count: (s.entries || []).length,
            lastSeen: s.lastSeen || 0,
        })).sort((a, b) => b.lastSeen - a.lastSeen),
    };
}

/** 所有世界的汇总统计 */
export function bookStats(worlds) {
    const list = Object.entries(worlds || {}).map(([k, w]) => ({ key: k, ...worldStats(w) }));
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    return {
        worldCount: list.length,
        totalEntries: list.reduce((a, x) => a + x.count, 0),
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
