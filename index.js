/**
 * 跨世界陪伴角色 (CMCC / STCMCC) · SillyTavern 扩展
 *
 * 一个固定的角色陪你玩任何卡，记得你们经历过的一切。
 *
 * 架构：
 *   记忆本体 —— 存进世界书 `CMCC-记忆库`（ST 原生注入，写正文的 AI 直接可读，用户可编辑）
 *   动态引导 —— 挂在 CHAT_COMPLETION_SETTINGS_READY，注入「你在哪 / 怎么用记忆」
 *
 * 依赖：只用官方扩展契约（getContext / eventSource / generateQuietPrompt）
 */

import { getContext, extension_settings } from '../../../../scripts/extensions.js';
import { eventSource, event_types } from '../../../../script.js';

import {
    MODULE, APP_NAME, APP_ABBR, DEFAULT_SETTINGS,
    worldKey, worldLabel, saveKey,
    emptyWorld, ensureSave, addMemory, renameSave, deleteSave,
    editMemory, deleteMemory, renameWorld,
    worldStats, bookStats,
    migrateFromLocalStorage, clearLegacyKeys,
} from './src/state.js';

import {
    WORLD_BOOK, C_IDENTITY, C_SHARED, C_PREFIX_WORLD,
    readBook, writeBook, upsertEntry, findEntry, removeEntry,
    serializeWorld, parseWorld, serializeShared, parseShared,
} from './src/store.js';

import { buildGuide, injectIntoRequest, estimateTokens } from './src/inject.js';
import { renderPanel } from './src/ui.js';
import { mountTopDrawer, renderTopPanel, openTopPanel } from './src/topbar.js';

const LOG = `[${APP_ABBR}]`;
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);

/** 记忆已加载到内存的工作副本（世界书是持久层） */
const CACHE = {
    loaded: false,
    companionAvatar: '',
    /** worldKey -> world 模型 */
    worlds: {},
    /** 共同记忆 */
    shared: [],
    /** 每个存档上次看到的记忆条数（用于判断是否有新增） */
    lastCounts: {},
};

const autoState = {
    counters: {},       // "world|save" -> 自上次整理后的消息数
    lastRun: 0,
    running: false,
    lastWorld: '',
    lastSave: '',
    justSwitched: false,
};

let settings = { ...DEFAULT_SETTINGS };
let panel = null;

function ctx() { return getContext(); }

// ─────────────────────────────────────────────
// 位置
// ─────────────────────────────────────────────

function currentPos() {
    const c = ctx();
    let avatar = '';
    let charName = '';
    try {
        const ch = c.characters?.[c.characterId];
        if (ch) { avatar = ch.avatar || ''; charName = ch.name || ''; }
    } catch (e) { /* ignore */ }

    const wKey = worldKey({ avatar, groupId: c.groupId });
    const wLabel = worldLabel({ charName, groupId: c.groupId, groups: c.groups });

    let chatId = '';
    try { chatId = c.getCurrentChatId?.() || ''; } catch (e) { /* ignore */ }
    return { wKey, wLabel, sKey: saveKey(chatId), chatId, avatar, charName, groupId: c.groupId };
}

function posKey(p) { return p.wKey + '|' + p.sKey; }

function findCompanion(avatar) {
    if (!avatar) return null;
    return (ctx().characters || []).find((c) => c && c.avatar === avatar) || null;
}

function isTalkingToCompanion(p) {
    return !!(settings.companionAvatar && p.avatar === settings.companionAvatar);
}

// ─────────────────────────────────────────────
// 世界书 ↔ 内存模型 同步
// ─────────────────────────────────────────────

/** 从世界书载入到 CACHE */
async function loadFromBook() {
    const book = await readBook();

    // 迁移旧的 localStorage 记忆（只做一次）
    if (!CACHE.loaded) {
        const legacy = migrateFromLocalStorage();
        if (legacy && !Object.keys(CACHE.worlds).length) {
            // 世界书里还没有世界词条时才迁移，避免覆盖
            const hasWorldEntries = Object.values(book.entries || {})
                .some((e) => (e.comment || '').startsWith(C_PREFIX_WORLD));
            if (!hasWorldEntries) {
                CACHE.companionAvatar = legacy.companionAvatar || '';
                CACHE.worlds = legacy.worlds || {};
                CACHE.shared = legacy.shared || [];
                await saveToBook(book);
                clearLegacyKeys();
                log('已把旧记忆迁移到世界书', { worlds: Object.keys(CACHE.worlds).length });
            } else {
                clearLegacyKeys();
            }
        }
    }

    // 世界 → 读回
    CACHE.worlds = {};
    for (const e of Object.values(book.entries || {})) {
        const cm = e.comment || '';
        if (!cm.startsWith(C_PREFIX_WORLD)) continue;
        const parsed = parseWorld(e.content || '');
        const k = cm.slice(C_PREFIX_WORLD.length);
        const world = emptyWorld(parsed.label || k);
        world.saves = {};
        for (const [name, s] of Object.entries(parsed.saves || {})) {
            world.saves[name] = {
                label: name,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                entries: (s.entries || []).map((x) => ({ ts: x.ts, text: x.text, kind: x.kind })),
            };
        }
        CACHE.worlds[k] = world;
    }

    // 共同记忆
    const sh = findEntry(book, C_SHARED);
    CACHE.shared = sh ? parseShared(sh.content || '') : [];

    CACHE.loaded = true;
    return book;
}

/** 把 CACHE 写回世界书 */
async function saveToBook(bookIn) {
    const book = bookIn || await readBook();

    for (const [k, w] of Object.entries(CACHE.worlds)) {
        upsertEntry(book, C_PREFIX_WORLD + k, serializeWorld(w.label, w.saves));
    }
    // 清掉内存里已不存在的世界词条
    for (const e of Object.values(book.entries || {})) {
        const cm = e.comment || '';
        if (!cm.startsWith(C_PREFIX_WORLD)) continue;
        const k = cm.slice(C_PREFIX_WORLD.length);
        if (!CACHE.worlds[k]) removeEntry(book, cm);
    }
    upsertEntry(book, C_SHARED, serializeShared(CACHE.shared));

    await writeBook(book);
    return book;
}

/**
 * 同步当前位置：确保世界与存档存在，检测切换
 * @returns {{saveLabel:string, saveCount:number, otherSaveLabels:string[], switched:boolean, isNew:boolean}}
 */
async function syncPosition(p, { persist = true } = {}) {
    const book = await loadFromBook();
    const w = CACHE.worlds[p.wKey] || (CACHE.worlds[p.wKey] = emptyWorld(p.wLabel));
    w.label = p.wLabel || w.label;
    const { save, isNew } = ensureSave(w, p.sKey, '');

    const switched = !!(autoState.lastSave && autoState.lastSave !== p.sKey);
    const changedWorld = !!(autoState.lastWorld && autoState.lastWorld !== p.wKey);

    if (isNew && (autoState.lastSave || autoState.lastWorld)) {
        addMemory(w, p.sKey,
            `和 {user} 来到了「${p.wLabel}」的新开始`
            + (changedWorld ? '（换了个地方）' : '（同一个地方，重新开始）'),
            'meta');
        if (persist) await saveToBook(book);
    } else if (persist && isNew) {
        await saveToBook(book);
    }

    autoState.lastWorld = p.wKey;
    autoState.lastSave = p.sKey;
    autoState.justSwitched = switched || changedWorld;

    const others = Object.entries(w.saves)
        .filter(([k]) => k !== p.sKey)
        .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
        .map(([, s]) => s.label);

    return {
        saveLabel: save.label,
        saveCount: Object.keys(w.saves).length,
        otherSaveLabels: others,
        switched: switched || changedWorld,
        isNew,
    };
}

// ─────────────────────────────────────────────
// 注入
// ─────────────────────────────────────────────

function onSettingsReady(generateData) {
    try {
        if (!settings.enabled || !settings.companionAvatar) return;
        const p = currentPos();
        if (isTalkingToCompanion(p)) return;

        const companion = findCompanion(settings.companionAvatar);
        if (!companion) return;

        // 用缓存里的信息（同步操作，不在事件里 await）
        const w = CACHE.worlds[p.wKey];
        const save = w?.saves?.[p.sKey];
        const others = w ? Object.entries(w.saves)
            .filter(([k]) => k !== p.sKey)
            .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
            .map(([, s]) => s.label) : [];

        const text = buildGuide({
            companion,
            wLabel: p.wLabel,
            saveLabel: save?.label || '本次',
            saveCount: w ? Object.keys(w.saves).length : 1,
            otherSaveLabels: others,
            settings,
            saveSwitched: autoState.justSwitched,
        });
        if (!text) return;

        if (injectIntoRequest(generateData, text)) {
            autoState.justSwitched = false;
            if (settings.debug) {
                log('已注入引导 %d 字符 / 约 %d token（世界=%s 存档=%s）',
                    text.length, estimateTokens(text), p.wLabel, save?.label || '?');
                console.debug(text);
                log('记忆世界书：%s（%d 个世界）', WORLD_BOOK, Object.keys(CACHE.worlds).length);
            }
        }
    } catch (e) {
        warn('注入失败', e);
    }
}

// ─────────────────────────────────────────────
// 记忆整理
// ─────────────────────────────────────────────

function summarizePrompt(companionName, worldName, saveName, transcript) {
    return [
        '你是记忆整理器。下面是一段角色扮演对话的节选。',
        `对话里有一位【跨世界陪伴者】，名叫「${companionName}」，`,
        '她跟随用户穿越各个世界，记得和用户经历的一切。',
        '',
        `当前位置：世界「${worldName}」，这一次是「${saveName}」。`,
        '',
        '请从**这位陪伴者的视角**提取她新获得的信息，输出严格 JSON（不要解释、不要 markdown 代码块）：',
        '{',
        '  "entries": ["她亲身经历或得知的事，每条一句话，第一人称省略主语，不超过 40 字"]',
        '}',
        '',
        '要求：',
        '- 只写**确实发生过**的事，不要推测、不要编造。',
        '- 优先记录：地点变化、遇到的人、关键事件、与用户之间的互动。',
        '- 最多 6 条；没有新信息就输出 {"entries":[]}。',
        '',
        '对话节选：',
        transcript,
    ].join('\n');
}

function parseSummaries(raw) {
    if (!raw) return { entries: [] };
    let t = String(raw).trim();
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try {
        const j = JSON.parse(t);
        const arr = Array.isArray(j.entries) ? j.entries
            : Array.isArray(j.world) ? j.world : [];
        return { entries: arr.filter((x) => typeof x === 'string') };
    } catch (e) {
        warn('记忆解析失败，原始输出：', raw);
        return { entries: [] };
    }
}

function transcript(n = 30) {
    const c = ctx();
    return (c.chat || []).slice(-n).map((m) => {
        const who = m.is_user ? (c.name1 || 'USER') : (m.name || 'CHAR');
        let text = m.mes || '';
        if (text.length > 500) text = text.slice(0, 500) + '…';
        return `${who}: ${text}`;
    }).join('\n');
}

async function summarize(manual = false) {
    if (autoState.running) return;
    const p = currentPos();

    if (!settings.companionAvatar) {
        if (manual) ctx().toastr?.warning?.('请先选择陪伴角色卡');
        return;
    }
    if (!(ctx().chat || []).length) {
        if (manual) ctx().toastr?.warning?.('当前聊天还没有内容');
        return;
    }

    const now = Date.now();
    if (!manual && now - autoState.lastRun < (settings.summarizeCooldown || 90) * 1000) return;

    let companionName = '同伴';
    const comp = findCompanion(settings.companionAvatar);
    if (comp) companionName = comp.name || companionName;

    autoState.running = true;
    try {
        const c = ctx();
        if (typeof c.generateQuietPrompt !== 'function') {
            warn('当前 ST 版本没有 generateQuietPrompt');
            return;
        }
        const tp = transcript(30);
        if (!tp.trim()) return;

        await loadFromBook();
        const saveLabel = CACHE.worlds[p.wKey]?.saves?.[p.sKey]?.label || '本次';

        if (settings.debug) log('开始整理记忆…');
        const raw = await c.generateQuietPrompt(
            summarizePrompt(companionName, p.wLabel, saveLabel, tp), false, false);
        const got = parseSummaries(raw);

        await loadFromBook();   // 重新读，避免覆盖期间的用户编辑
        const w = CACHE.worlds[p.wKey] || (CACHE.worlds[p.wKey] = emptyWorld(p.wLabel));
        got.entries.forEach((x) => addMemory(w, p.sKey, x, 'auto'));
        await saveToBook();

        autoState.lastRun = now;
        autoState.counters[posKey(p)] = 0;
        panel?.refresh();

        if (settings.debug || manual) {
            log('整理完成: +%d 条（%s / %s）', got.entries.length, p.wLabel, saveLabel);
        }
        if (manual) c.toastr?.success?.(`记忆已整理：新增 ${got.entries.length} 条`);
    } catch (e) {
        warn('整理记忆出错', e);
        if (manual) ctx().toastr?.error?.('整理记忆失败，详见控制台');
    } finally {
        autoState.running = false;
    }
}

function onMessageReceived() {
    if (!settings.enabled || !settings.companionAvatar) return;
    const p = currentPos();
    if (isTalkingToCompanion(p)) return;
    const k = posKey(p);
    autoState.counters[k] = (autoState.counters[k] || 0) + 1;
    if (autoState.counters[k] >= (settings.summarizeEvery || 12)) summarize(false);
}

// ─────────────────────────────────────────────
// 对外操作（给 UI 用）
// ─────────────────────────────────────────────

const api = {
    /** 当前记忆快照（给面板渲染） */
    snapshot() {
        return {
            bookName: WORLD_BOOK,
            companionAvatar: CACHE.companionAvatar,
            stats: bookStats(CACHE.worlds),
            shared: CACHE.shared,
            worlds: CACHE.worlds,
        };
    },
    async setCompanion(avatar) {
        CACHE.companionAvatar = avatar;
        settings.companionAvatar = avatar;
        onSave();
        const book = await loadFromBook();
        const comp = findCompanion(avatar);
        if (comp) {
            const d = comp.data || comp;
            const txt = [
                `# ${d.name || comp.name || '同伴'}`,
                '',
                '> 这个角色是 {user} 的**跨世界陪伴者**。',
                '> 她跟着 {user} 走过多个世界，记得一起经历的事。',
                '',
                '## 人设',
                (d.description || '（角色卡未填 description）').trim(),
                '',
                '## 性格',
                (d.personality || '（角色卡未填 personality）').trim(),
            ].join('\n');
            upsertEntry(book, C_IDENTITY, txt);
            await writeBook(book);
        }
        panel?.refresh();
    },
    async renameSave(wKey, sKey, name) {
        await loadFromBook();
        const w = CACHE.worlds[wKey];
        if (!w) return;
        renameSave(w, sKey, name);
        await saveToBook();
        panel?.refresh();
    },
    async deleteSave(wKey, sKey) {
        await loadFromBook();
        const w = CACHE.worlds[wKey];
        if (!w) return;
        deleteSave(w, sKey);
        if (!Object.keys(w.saves).length) delete CACHE.worlds[wKey];
        await saveToBook();
        panel?.refresh();
    },
    async renameWorld(wKey, name) {
        await loadFromBook();
        const w = CACHE.worlds[wKey];
        if (!w) return;
        renameWorld(w, name);
        await saveToBook();
        panel?.refresh();
    },
    async editMemory(wKey, sKey, index, text) {
        await loadFromBook();
        const w = CACHE.worlds[wKey];
        if (!w) return;
        editMemory(w, sKey, index, text);
        await saveToBook();
        panel?.refresh();
    },
    async deleteMemory(wKey, sKey, index) {
        await loadFromBook();
        const w = CACHE.worlds[wKey];
        if (!w) return;
        deleteMemory(w, sKey, index);
        await saveToBook();
        panel?.refresh();
    },
    async addMemory(wKey, sKey, text) {
        await loadFromBook();
        const w = CACHE.worlds[wKey] || (CACHE.worlds[wKey] = emptyWorld('未知世界'));
        addMemory(w, sKey, text, 'manual');
        await saveToBook();
        panel?.refresh();
    },
    async addShared(text) {
        await loadFromBook();
        CACHE.shared.push({ ts: Date.now(), text: String(text).trim(), kind: 'manual' });
        await saveToBook();
        panel?.refresh();
    },
    async editShared(index, text) {
        await loadFromBook();
        if (CACHE.shared[index]) { CACHE.shared[index].text = String(text).trim(); await saveToBook(); }
        panel?.refresh();
    },
    async deleteShared(index) {
        await loadFromBook();
        CACHE.shared.splice(index, 1);
        await saveToBook();
        panel?.refresh();
    },
    async reload() {
        await loadFromBook();
        panel?.refresh();
    },
    /**
     * 改陪伴角色卡的人设字段（description / personality / scenario / first_mes）
     * 直接写回角色卡并保存；同时刷新世界书里的「[CMCC] 她是谁」
     */
    async editPersona(key, value) {
        const av = settings.companionAvatar;
        const comp = findCompanion(av);
        if (!comp) { ctx().toastr?.warning?.('找不到陪伴角色卡'); return false; }
        const d = comp.data || comp;
        d[key] = value;
        try {
            await ctx().saveCharacterDebounced?.();
        } catch (e) { /* ignore */ }
        // 部分 ST 版本用这个
        try { ctx().saveSettingsDebounced?.(); } catch (e) { /* ignore */ }
        // 同步世界书里的人设词条
        await api.setCompanion(av);
        ctx().toastr?.success?.(`已更新「${key}」（若未落盘，请在角色管理里点保存）`);
        return true;
    },
    summarize: (m) => summarize(m),
    currentPos,
    /** 顶部面板重绘 */
    refreshTop() {
        try {
            renderTopPanel({ ctx: ctx(), api, onGotoSettings: gotoPluginSettings });
        } catch (e) { /* ignore */ }
    },
};

// ─────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────

function onSave() {
    extension_settings[MODULE] = settings;
    ctx().saveSettingsDebounced?.();
}

/** 跳到扩展设置页（和酒馆助手同位置）并高亮本插件 */
function gotoPluginSettings() {
    try {
        const btn = document.getElementById('extensions-settings-button')
            ?.querySelector('.drawer-toggle');
        const panelEl = document.getElementById('rm_extensions_block');
        if (panelEl && !panelEl.classList.contains('openDrawer')) {
            btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        setTimeout(() => {
            const root = document.getElementById('cmcc_settings');
            root?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            root?.classList.add('cmcc-flash');
            setTimeout(() => root?.classList.remove('cmcc-flash'), 1200);
        }, 260);
    } catch (e) { /* ignore */ }
}

jQuery(async () => {
    extension_settings[MODULE] = extension_settings[MODULE] || {};
    settings = Object.assign({}, DEFAULT_SETTINGS, extension_settings[MODULE]);
    CACHE.companionAvatar = settings.companionAvatar || '';

    if (settings.enabled && settings.companionAvatar) {
        try { await loadFromBook(); } catch (e) { warn('载入世界书失败', e); }
    }

    // 顶部入口（酒馆顶部图标栏）
    try {
        mountTopDrawer();
        refreshTop();
    } catch (e) { warn('顶部入口挂载失败', e); }

    // 扩展到设置页（和酒馆助手同位置）
    panel = renderPanel({
        settings, onSave, ctx: ctx(), api,
        onOpenTop: () => {
            openTopPanel();
            refreshTop();
        },
    });

    if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
    }
    if (event_types.GENERATE_AFTER_DATA) {
        eventSource.on(event_types.GENERATE_AFTER_DATA, (data) => {
            if (data && Array.isArray(data.messages)) onSettingsReady(data);
        });
    }
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, async () => {
            try { await syncPosition(currentPos()); } catch (e) { /* ignore */ }
            panel?.refresh();
            refreshTop();
        });
    }

    try { await syncPosition(currentPos()); } catch (e) { /* ignore */ }

    log('已加载。陪伴者=%s 启用=%s 记忆世界书=%s',
        settings.companionAvatar || '(未选)', settings.enabled, WORLD_BOOK);
});
