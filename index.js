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
    MODULE, APP_NAME, APP_ABBR, DEFAULT_SETTINGS, normalizeSettings,
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

import { buildGuide, buildMemoryBlock, buildInjectionText, injectIntoRequest,
         estimateTokens, WORLDBOOK_CHANNEL } from './src/inject.js';
import { parseMemoryCommands, commandSpec, stripBlocks } from './src/memo.js';
import { renderPanel } from './src/ui.js';
import { mountTopDrawer, renderTopPanel, openTopPanel, setRenderHook } from './src/topbar.js';

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
    /** 已处理过的消息签名（避免同一段正文重复写入） */
    seen: new Set(),
    /** 待写入的位置（按需创建世界/存档时用） */
    pendingWorld: null,
    pendingSave: null,
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

/**
 * 取当前「陪伴者人设」（不依赖角色卡库）
 *   personaMode === 'builtin' → 用设置里内置的人设（完全独立）
 *   personaMode === 'card'    → 用角色库里的卡
 */
function resolveCompanion() {
    if (settings.personaMode === 'builtin') {
        const b = settings.builtin || {};
        if (!b.name && !b.description) return null;
        return {
            name: b.name || '同伴',
            isBuiltin: true,
            data: {
                name: b.name || '同伴',
                description: b.description || '',
                personality: b.personality || '',
                scenario: b.scenario || '',
            },
        };
    }
    return findCompanion(settings.companionAvatar);
}

/** 是否已选好陪伴者（两种模式各自的判据） */
function hasCompanion() {
    if (settings.personaMode === 'builtin') {
        const b = settings.builtin || {};
        return !!(b.name || b.description || b.personality);
    }
    return !!settings.companionAvatar;
}

function isTalkingToCompanion(p) {
    // 只有「用角色卡」模式才可能正在和她本人聊天
    if (settings.personaMode === 'builtin') return false;
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

/**
 * 清掉内存模型里的空存档 / 空世界
 * 用途：旧版本会给每个进过的存档建空壳，升级后需要收一次尾。
 * @returns {{saves:number, worlds:number}} 各清理了多少
 */
function purgeEmpty() {
    let saves = 0, worlds = 0;
    for (const [wk, w] of Object.entries(CACHE.worlds)) {
        if (!w?.saves) { delete CACHE.worlds[wk]; worlds++; continue; }
        for (const [sk, s] of Object.entries(w.saves)) {
            // "__world__" 是世界级记忆的容器，只有它空了才算空
            if (!(s.entries || []).length) { delete w.saves[sk]; saves++; }
        }
        if (!Object.keys(w.saves).length) { delete CACHE.worlds[wk]; worlds++; }
    }
    return { saves, worlds };
}

/** 把 CACHE 写回世界书 */
async function saveToBook(bookIn) {
    // 关掉「同步世界书」时：只维护内存模型，不落盘（记忆仍会直接注入提示词）
    if (settings.syncWorldbook === false) return null;
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
 * 同步当前位置：**只记录当前位置，不创建任何空世界/空存档**
 *
 * 旧行为会给每个进过的存档建一个空壳，结果记忆面板里堆满 "(暂无)"。
 * 新行为：世界与存档**按需创建** —— 只有当真的写进一条记忆时才建。
 *
 * @returns {{saveLabel:string, saveCount:number, otherSaveLabels:string[], switched:boolean, isNew:boolean}}
 */
async function syncPosition(p, { persist = true } = {}) {
    const book = await loadFromBook();

    // 只读地看一眼当前位置（不创建）
    const w = CACHE.worlds[p.wKey] || null;
    const save = w?.saves?.[p.sKey] || null;
    const isNew = !save;

    const switched = !!(autoState.lastSave && autoState.lastSave !== p.sKey);
    const changedWorld = !!(autoState.lastWorld && autoState.lastWorld !== p.wKey);

    autoState.lastWorld = p.wKey;
    autoState.lastSave = p.sKey;
    autoState.justSwitched = switched || changedWorld;
    // 未落盘的"待写入位置"：等到真有记忆时再用它建
    autoState.pendingWorld = { key: p.wKey, label: p.wLabel };
    autoState.pendingSave = { key: p.sKey, label: p.saveLabel || '' };

    // 世界通道 __world__ 不算「存档」
    const otherEntries = w ? Object.entries(w.saves)
        .filter(([k]) => k !== p.sKey && k !== WORLDBOOK_CHANNEL) : [];
    const others = otherEntries
        .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
        .map(([, s]) => s.label);

    return {
        saveLabel: save?.label || p.saveLabel || '本次',
        saveCount: w
            ? Object.keys(w.saves).filter((k) => k !== WORLDBOOK_CHANNEL).length
            : 0,
        otherSaveLabels: others,
        switched: switched || changedWorld,
        isNew,
    };
}

/**
 * 按需创建世界/存档（只在真的要写记忆时调用）
 * @returns {{world:object, save:object, created:{world:boolean, save:boolean}}}
 */
function ensurePosition(p) {
    let created = { world: false, save: false };
    let w = CACHE.worlds[p.wKey];
    if (!w) {
        w = emptyWorld(p.wLabel || '未知世界');
        CACHE.worlds[p.wKey] = w;
        created.world = true;
    } else if (p.wLabel && w.label !== p.wLabel) {
        w.label = p.wLabel;
    }
    let s = w.saves[p.sKey];
    if (!s) {
        const r = ensureSave(w, p.sKey, p.saveLabel || '');
        s = r.save;
        created.save = true;
    }
    return { world: w, save: s, created };
}

/**
 * 写一条记忆（自动创建世界/存档）
 * @param {object} pos currentPos() 的结果
 * @param {{scope?:string, kind?:string, text:string}} entry
 */
async function writeMemory(pos, entry) {
    if (!entry || !entry.text) return false;
    const scope = entry.scope || 'save';
    const book = await loadFromBook();

    if (scope === 'shared') {
        // 共同记忆：所有世界通用
        let sh = CACHE.worlds.__shared__;
        if (!sh) { sh = emptyWorld('共同'); CACHE.worlds.__shared__ = sh; }
        const r = ensureSave(sh, 'common', '共同');
        addMemory(sh, 'common', entry.text, entry.kind || 'shared');
        await saveToBook(book);
        return r.save;
    }

    const { world } = ensurePosition(pos);
    if (scope === 'world') {
        // 世界级：挂在一个固定的 "__world__" 存档下，注入时并入当前世界
        ensureSave(world, WORLDBOOK_CHANNEL, '整个世界');
        addMemory(world, WORLDBOOK_CHANNEL, entry.text, entry.kind || 'world');
        await saveToBook(book);
        return true;
    }
    // 存档级（默认）
    ensureSave(world, pos.sKey, pos.saveLabel || '');
    addMemory(world, pos.sKey, entry.text, entry.kind || 'memo');
    await saveToBook(book);
    return true;
}

// ─────────────────────────────────────────────
// 注入
// ─────────────────────────────────────────────

function onSettingsReady(generateData) {
    try {
        if (!settings.enabled || !hasCompanion()) return;
        const p = currentPos();
        if (isTalkingToCompanion(p)) return;

        const companion = resolveCompanion();
        if (!companion) return;

        // 用缓存里的信息（同步操作，不在事件里 await）
        const w = CACHE.worlds[p.wKey];
        const save = w?.saves?.[p.sKey];
        const others = w ? Object.entries(w.saves)
            .filter(([k]) => k !== p.sKey)
            .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
            .map(([, s]) => s.label) : [];

        const guide = buildGuide({
            companion,
            wLabel: p.wLabel,
            saveLabel: save?.label || '本次',
            saveCount: w
                ? Object.keys(w.saves).filter((k) => k !== WORLDBOOK_CHANNEL).length : 0,
            otherSaveLabels: others,
            settings,
            saveSwitched: autoState.justSwitched,
            // MVU 式：告诉她怎么输出记忆块
            memoSpec: settings.readMemoryCommands === false ? '' : commandSpec(),
        });
        if (!guide) return;

        // 记忆直接注入（不依赖世界书挂载）
        const memory = settings.injectMemory
            ? buildMemoryBlock({
                mem: CACHE,
                wKey: p.wKey, sKey: p.sKey, wLabel: p.wLabel,
                budget: settings.memoryBudget || 1800,
                saveLimit: settings.saveMemoryLimit || 500,
            })
            : '';

        const text = buildInjectionText({ guide, memory });
        if (!text) return;

        if (injectIntoRequest(generateData, text)) {
            autoState.justSwitched = false;
            if (settings.debug) {
                log('已注入 %d 字符 / 约 %d token（引导 %d + 记忆 %d）世界=%s 存档=%s',
                    text.length, estimateTokens(text),
                    estimateTokens(guide), estimateTokens(memory),
                    p.wLabel, save?.label || '?');
                console.debug(text);
                log('记忆：%d 个世界 / %d 条',
                    Object.keys(CACHE.worlds).length,
                    Object.values(CACHE.worlds)
                        .reduce((a, x) => a + Object.values(x.saves || {})
                            .reduce((b, s) => b + (s.entries || []).length, 0), 0));
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

    if (!hasCompanion()) {
        if (manual) ctx().toastr?.warning?.(
            settings.personaMode === 'builtin'
                ? '请先填写内置陪伴角色的人设（名字/描述）'
                : '请先选择陪伴角色卡');
        return;
    }
    if (!(ctx().chat || []).length) {
        if (manual) ctx().toastr?.warning?.('当前聊天还没有内容');
        return;
    }

    const now = Date.now();
    if (!manual && now - autoState.lastRun < (settings.summarizeCooldown || 90) * 1000) return;

    let companionName = '同伴';
    const comp = resolveCompanion();
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

/**
 * ★ MVU 式记忆：AI 生成结束后，读它正文里的 ```cmcc 代码块
 *
 * 流程：MESSAGE_RECEIVED → 取最后一条 AI 消息 → 解析代码块 → 按范围写记忆
 * 去重：用「消息索引 + 内容哈希」记账，同一条消息不会重复写入。
 */
async function onMessageReceived(index) {
    if (!settings.enabled || !hasCompanion()) return;
    if (settings.readMemoryCommands === false) return;

    const p = currentPos();
    if (isTalkingToCompanion(p)) return;

    try {
        const c = ctx();
        const chat = c.chat || [];
        // ST 传进来的 index 是消息下标；没有就往回找最后一条 AI 消息
        let msg = (typeof index === 'number' && chat[index]) ? chat[index] : null;
        if (!msg) {
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i]?.is_user) { msg = chat[i]; break; }
            }
        }
        const text = typeof msg?.mes === 'string' ? msg.mes : '';
        if (!text) return;

        const { entries, errors, blockCount } = parseMemoryCommands(text);
        if (errors.length && settings.debug) {
            warn('记忆块解析提示：%s', errors.join(' / '));
        }
        if (!blockCount) return;

        // 去重：这条消息已经处理过就跳过
        const sig = String(text.length) + ':' + text.slice(-80);
        autoState.seen = autoState.seen || new Set();
        if (autoState.seen.has(sig)) return;
        autoState.seen.add(sig);
        if (autoState.seen.size > 400) {
            autoState.seen = new Set([...autoState.seen].slice(-200));
        }

        if (!entries.length) {
            if (settings.debug) log('发现记忆块，但没有有效条目');
            return;
        }

        let n = 0;
        for (const e of entries) {
            try { await writeMemory(p, e); n++; } catch (err) { warn('写记忆失败', err); }
        }
        if (n) {
            log('从正文记忆块写入 %d 条（%s / %s）', n, p.wLabel, p.saveLabel || '本次');
            panel?.refresh();
            api.refreshTop();
        }
    } catch (e) {
        warn('解析正文记忆块失败', e);
    }
}

/** 兜底：老路径的自动整理（消息计数触发） */
function onMessageCounted() {
    if (!settings.enabled || !hasCompanion()) return;
    const p = currentPos();
    if (isTalkingToCompanion(p)) return;
    const k = posKey(p);
    autoState.counters[k] = (autoState.counters[k] || 0) + 1;
    if (autoState.counters[k] >= (settings.summarizeEvery || 12)) summarize(false);
}

// ─────────────────────────────────────────────
// 对外操作（给 UI 用）
// ─────────────────────────────────────────────

/**
 * 把陪伴者人设同步进世界书的「[CMCC] 她是谁」词条
 * 目的：即使不用内置注入，用户也能在 ST 世界书编辑器里看到她的人设；
 *      内置模式下这是**唯一**的人设落盘处（不进角色卡库）。
 */
async function syncIdentityEntry(book, comp) {
    if (!comp) return;
    if (settings.syncWorldbook === false) return;
    const d = comp.data || comp;
    const mode = settings.personaMode === 'builtin' ? '内置人设' : '角色卡';
    const txt = [
        `# ${d.name || comp.name || '同伴'}`,
        '',
        '> 跨世界陪伴者（来源：' + mode + '）。',
        '> 她跟着 {user} 走过多个世界，记得一起经历的事。',
        '',
        '## 人设',
        (d.description || '（未填写）').trim(),
        '',
        '## 性格',
        (d.personality || '（未填写）').trim(),
        '',
        '## 与 {user} 的关系',
        (d.scenario || '（未填写）').trim(),
    ].join('\n');
    upsertEntry(book, C_IDENTITY, txt);
    await writeBook(book);
}

const api = {
    /** 当前记忆快照（给面板渲染） */
    snapshot() {
        const mode = settings.personaMode || 'builtin';
        const comp = resolveCompanion();
        return {
            bookName: WORLD_BOOK,
            personaMode: mode,
            companionAvatar: CACHE.companionAvatar,
            companionName: comp?.name || (mode === 'builtin' ? '（未填写人设）' : '（未选择）'),
            injectMemory: settings.injectMemory !== false,
            syncWorldbook: settings.syncWorldbook !== false,
            hasCompanion: hasCompanion(),
            builtin: settings.builtin || {},
            stats: bookStats(CACHE.worlds),
            shared: CACHE.shared,
            worlds: CACHE.worlds,
        };
    },
    /** 切到「用角色卡」模式并指定卡 */
    async setCompanion(avatar) {
        settings.personaMode = 'card';
        CACHE.companionAvatar = avatar;
        settings.companionAvatar = avatar;
        onSave();
        const book = await loadFromBook();
        const comp = findCompanion(avatar);
        if (comp) {
            await syncIdentityEntry(book, comp);
        }
    },
    /** 改内置人设（部分字段） */
    async setBuiltin(patch) {
        settings.personaMode = 'builtin';
        settings.builtin = Object.assign({}, settings.builtin || {}, patch || {});
        onSave();
        const book = await loadFromBook();
        await syncIdentityEntry(book, resolveCompanion());
    },
    /** 切模式 */
    async setPersonaMode(mode) {
        settings.personaMode = mode === 'card' ? 'card' : 'builtin';
        onSave();
        const book = await loadFromBook();
        await syncIdentityEntry(book, resolveCompanion());
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
     * 改陪伴者人设字段
     *   内置模式 → 存进扩展设置（不碰角色卡库）
     *   角色卡模式 → 写回角色卡并保存
     * 两种情况都会同步世界书的「[CMCC] 她是谁」词条
     */
    async editPersona(key, value) {
        if ((settings.personaMode || 'builtin') === 'builtin') {
            await api.setBuiltin({ [key]: value });
            ctx().toastr?.success?.(`已更新内置人设「${key}」`);
            return true;
        }
        const av = settings.companionAvatar;
        const comp = findCompanion(av);
        if (!comp) { ctx().toastr?.warning?.('找不到陪伴角色卡'); return false; }
        const d = comp.data || comp;
        d[key] = value;
        try { await ctx().saveCharacterDebounced?.(); } catch (e) { /* ignore */ }
        await api.setCompanion(av);   // 同步人设词条
        ctx().toastr?.success?.(`已更新「${key}」（若未落盘，请在角色管理里点保存）`);
        return true;
    },
    summarize: (m) => summarize(m),
    currentPos,
    /** 清掉空的存档/世界（旧版本留下的空壳） */
    async cleanEmpty() {
        const book = await loadFromBook();
        const r = purgeEmpty();
        await saveToBook(book);
        panel?.refresh();
        api.refreshTop();
        return r;
    },
    /** 给调试用：看一段正文会解析出什么 */
    previewCommands(text) {
        const r = parseMemoryCommands(String(text || ''));
        return { ...r, clean: stripBlocks(String(text || '')).slice(0, 200) };
    },
    /**
     * 顶部面板重绘
     * ⚠ 不要在这里吞异常 —— 之前写成 catch(e){} 导致"面板只有标题没内容"
     *   却看不到任何报错。现在出错会写进 console 并显示在面板里。
     */
    refreshTop() {
        try {
            renderTopPanel({ ctx: ctx(), api, onGotoSettings: gotoPluginSettings });
        } catch (e) {
            console.error(LOG, '顶部面板渲染失败', e);
            const body = document.getElementById('cmcc-top-panel_body');
            if (body) {
                body.innerHTML = '<div class="cmcc-empty" style="color:#ff9b9b">'
                    + '面板渲染失败：' + String(e && e.message || e)
                    + '<br><small>详见 F12 控制台</small></div>';
            }
        }
    },
};

// ─────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────

function onSave() {
    extension_settings[MODULE] = settings;
    ctx().saveSettingsDebounced?.();
}

/** 跳到扩展设置页（和酒馆助手同位置）并展开 + 高亮本插件 */
function gotoPluginSettings() {
    try {
        const btn = document.getElementById('extensions-settings-button')
            ?.querySelector('.drawer-toggle');
        const panelEl = document.getElementById('rm_extensions_block');
        if (panelEl && !panelEl.classList.contains('openDrawer')) {
            btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        // 本插件的抽屉若处于收起状态，先展开
        try { panel?.expand?.(); } catch (e) { /* ignore */ }
        setTimeout(() => {
            const root = document.getElementById('cmcc_settings');
            // 再兜一次：确保内容可见
            const content = root?.querySelector('.inline-drawer-content');
            if (content && getComputedStyle(content).display === 'none') {
                content.style.display = 'block';
                const ico = root.querySelector('.inline-drawer-icon');
                ico?.classList.remove('down', 'fa-circle-chevron-down');
                ico?.classList.add('up', 'fa-circle-chevron-up');
            }
            root?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            highlight(root);
        }, 280);
    } catch (e) { /* ignore */ }
}

/** 短暂高亮（用 outline 动画，不依赖已删除的 CSS 类） */
function highlight(node) {
    if (!node) return;
    const old = node.style.outline;
    node.style.transition = 'outline-color .3s ease';
    node.style.outline = '2px solid var(--SmartThemeQuoteColor, #7aa2f7)';
    setTimeout(() => {
        node.style.outline = old || '2px solid transparent';
        setTimeout(() => { node.style.outline = old; }, 320);
    }, 1100);
}

jQuery(async () => {
    extension_settings[MODULE] = extension_settings[MODULE] || {};
    settings = normalizeSettings(extension_settings[MODULE]);
    // 回写规范化后的设置，保证新增字段落盘
    extension_settings[MODULE] = settings;
    CACHE.companionAvatar = settings.companionAvatar || '';

    if (settings.enabled && hasCompanion()) {
        try { await loadFromBook(); } catch (e) { warn('载入世界书失败', e); }
    }

    // 顶部入口（酒馆顶部图标栏）
    try {
        // 注册重渲染钩子，供"打开面板时自愈"使用
        setRenderHook(() => api.refreshTop());
        mountTopDrawer();
        refreshTop();
    } catch (e) { warn('顶部入口挂载失败', e); }

    // ST 有时会在扩展加载后重建 / 异步补完 DOM（例如角色列表就绪时），
    // 若那时我们的图标被移除，这里补挂一次。
    setTimeout(() => {
        try {
            if (!document.getElementById('cmcc-top-drawer')) {
                warn('图标不见了，重新挂载');
                mountTopDrawer();
            }
            // 面板存在但内容是空的 → 再渲染一次
            const b = document.getElementById('cmcc-top-panel_body');
            if (b && b.children.length === 0) {
                warn('面板为空，补渲染');
                refreshTop();
            }
        } catch (e) { warn('补挂失败', e); }
    }, 1500);

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
        // MVU 式：读正文里的 `cmcc 记忆块（事件带消息下标）
        eventSource.on(event_types.MESSAGE_RECEIVED, (idx) => {
            onMessageReceived(idx);
            onMessageCounted();
        });
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, async () => {
            try { await syncPosition(currentPos()); } catch (e) { /* ignore */ }
            panel?.refresh();
            refreshTop();
        });
    }

    try { await syncPosition(currentPos()); } catch (e) { /* ignore */ }

    // 旧版本会给每个进过的存档建空壳，升级后收一次尾
    setTimeout(async () => {
        try {
            const book = await loadFromBook();
            const r = purgeEmpty();
            if (r.saves || r.worlds) {
                await saveToBook(book);
                log('清理空存档 %d 个 / 空世界 %d 个', r.saves, r.worlds);
                panel?.refresh();
                refreshTop();
            }
        } catch (e) { warn('清理空存档失败', e); }
    }, 2000);

    log('已加载。模式=%s 陪伴者=%s 启用=%s 记忆注入=%s',
        settings.personaMode, resolveCompanion()?.name || '(未设定)',
        settings.enabled, settings.injectMemory);
});
