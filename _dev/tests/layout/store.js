/**
 * 跨世界陪伴角色 (CMCC) · 记忆存储层 —— 世界书
 *
 * 设计决定（2026-10-04）：
 *   记忆不再存在 localStorage，而是写进一张**世界书**。
 *   理由：
 *     ① 写正文的 AI 能直接读到（世界书是 ST 原生注入通道）
 *     ② 用户可以用 ST 自带的世界书编辑器直接改
 *     ③ 可导出/分享/备份，跟着 ST 的数据走
 *
 * 世界书：CMCC-记忆库
 * 词条划分（每个世界一条，constant=true 常驻注入）：
 *   [CMCC] 她是谁            —— 从角色卡提取，只读
 *   [CMCC] 共同记忆           —— 跨世界通用
 *   [CMCC] 世界 · <世界名>    —— 该世界所有存档的记忆
 *
 * 用到的 ST API（均在 getContext() 上）：
 *   loadWorldInfo(name) / saveWorldInfo(name, data) / updateWorldInfoList()
 */

export const WORLD_BOOK = 'CMCC-记忆库';

const PREFIX = '[CMCC]';
export const C_IDENTITY = `${PREFIX} 她是谁`;
export const C_SHARED = `${PREFIX} 共同记忆`;
export const C_PREFIX_WORLD = `${PREFIX} 世界 · `;

// ─────────────────────────────────────────────
// 世界书条目模板
// ─────────────────────────────────────────────

export function entryTemplate(comment, content, uid) {
    return {
        uid,
        key: [],
        keysecondary: [],
        comment,
        content,
        constant: true,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 90,
        position: 1,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth: 4,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        triggers: [],
        displayIndex: uid,
        extensions: {
            position: 1,
            exclude_recursion: false,
            display_index: uid,
            probability: 100,
            useProbability: true,
            depth: 4,
            selectiveLogic: 0,
            group: '',
            group_override: false,
            group_weight: 100,
            prevent_recursion: false,
            delay_until_recursion: false,
            scan_depth: null,
            match_whole_words: null,
            use_group_scoring: false,
            case_sensitive: null,
            automation_id: '',
            role: 0,
            vectorized: false,
            sticky: 0,
            cooldown: 0,
            delay: 0,
        },
    };
}

// ─────────────────────────────────────────────
// 世界书读写（走 ST API）
// ─────────────────────────────────────────────

function ctx() { return globalThis.SillyTavern?.getContext?.(); }

function entriesOf(book) {
    const e = book?.entries;
    if (!e) return [];
    return Array.isArray(e) ? e : Object.values(e);
}

/** 读世界书；不存在返回空结构 */
export async function readBook() {
    const c = ctx();
    if (!c?.loadWorldInfo) throw new Error('ST 未提供 loadWorldInfo');
    let book = null;
    try {
        book = await c.loadWorldInfo(WORLD_BOOK);
    } catch (e) {
        book = null;
    }
    if (!book) {
        book = { entries: {} };
    }
    if (!book.entries) book.entries = {};
    if (!book.originalData) book.originalData = JSON.parse(JSON.stringify(book));
    return book;
}

/** 写世界书 */
export async function writeBook(book) {
    const c = ctx();
    if (!c?.saveWorldInfo) throw new Error('ST 未提供 saveWorldInfo');
    // 保持 entries 为对象形式（ST 内部用 uid 作键）
    if (Array.isArray(book.entries)) {
        const o = {};
        book.entries.forEach((e, i) => { o[String(e.uid ?? i)] = e; });
        book.entries = o;
    }
    await c.saveWorldInfo(WORLD_BOOK, book, true);
    try { await c.updateWorldInfoList?.(); } catch (e) { /* ignore */ }
    return book;
}

/** 取下一个空闲 uid */
export function nextUid(book) {
    const used = new Set(entriesOf(book).map((e) => Number(e.uid) || 0));
    let i = 0;
    while (used.has(i)) i++;
    return i;
}

/** upsert：按 comment 找，找不到就新建 */
export function upsertEntry(book, comment, content) {
    const list = entriesOf(book);
    const found = list.find((e) => (e.comment || '') === comment);
    if (found) {
        found.content = content;
        return found;
    }
    const e = entryTemplate(comment, content, nextUid(book));
    if (Array.isArray(book.entries)) book.entries.push(e);
    else book.entries[String(e.uid)] = e;
    return e;
}

export function findEntry(book, comment) {
    return entriesOf(book).find((e) => (e.comment || '') === comment) || null;
}

export function removeEntry(book, comment) {
    const list = entriesOf(book);
    const hit = list.find((e) => (e.comment || '') === comment);
    if (!hit) return false;
    if (Array.isArray(book.entries)) {
        book.entries = list.filter((e) => e !== hit);
    } else {
        delete book.entries[String(hit.uid)];
    }
    return true;
}

// ─────────────────────────────────────────────
// 记忆 ↔ 世界书内容的 序列化
// ─────────────────────────────────────────────

/**
 * 一个世界的内容格式（人类可读、可手改）：
 *
 *   # 全球冰封 v3.1.3
 *
 *   ## 存档1
 *   - 在避难所里冻了一夜
 *   - 找到一箱罐头
 *
 *   ## 存档2
 *   - 这次直接进了地堡
 */
export function serializeWorld(label, saves) {
    const p = [`# ${label}`];
    const list = Object.entries(saves || {})
        .sort((a, b) => (a[1].firstSeen || 0) - (b[1].firstSeen || 0));
    for (const [, s] of list) {
        p.push('');
        p.push(`## ${s.label}`);
        const items = s.entries || [];
        if (!items.length) p.push('（暂无）');
        else items.forEach((x) => p.push(`- ${x.text}`));
    }
    return p.join('\n');
}

/**
 * 反序列化：把用户手改过的内容读回来
 * 宽松解析 —— 认 `## 存档名` 与 `- 记忆` 两种行
 */
export function parseWorld(content) {
    const lines = String(content || '').split('\n');
    const saves = {};
    let cur = null;
    let label = '';
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('# ') && !line.startsWith('## ')) {
            label = line.slice(2).trim();
            continue;
        }
        if (line.startsWith('## ')) {
            const name = line.slice(3).trim();
            cur = { label: name, entries: [] };
            saves[name] = cur;
            continue;
        }
        if (line.startsWith('- ') && cur) {
            const text = line.slice(2).trim();
            if (text && text !== '（暂无）') cur.entries.push({ text, ts: Date.now(), kind: 'manual' });
        }
    }
    return { label, saves };
}

/** 共同记忆格式 */
export function serializeShared(entries) {
    const items = entries || [];
    if (!items.length) return '# 我们之间一直没变的事\n\n（暂无）';
    return ['# 我们之间一直没变的事', '', ...items.map((x) => `- ${x.text}`)].join('\n');
}

export function parseShared(content) {
    const out = [];
    for (const raw of String(content || '').split('\n')) {
        const line = raw.trim();
        if (line.startsWith('- ')) {
            const text = line.slice(2).trim();
            if (text && text !== '（暂无）') out.push({ text, ts: Date.now(), kind: 'manual' });
        }
    }
    return out;
}
