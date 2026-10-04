/**
 * CMCC · 记忆指令解析（MVU 式）
 *
 * 思路与 MVU 变量一致：
 *   AI 每次生成正文后，在末尾输出一个 ```cmcc 代码块，
 *   插件直接读取块里的内容，写进对应世界/存档的记忆。
 *
 * 支持的块格式（两种都认，方便 AI 输出也方便手写）：
 *
 * ── 格式 1：JSON ──
 *   ```cmcc
 *   { "memory": [
 *       { "scope": "save",   "kind": "event", "text": "在避难所里冻了一夜" },
 *       { "scope": "shared", "kind": "fact",  "text": "USER 怕冷" }
 *   ] }
 *   ```
 *
 * ── 格式 2：行式（更省 token，推荐）──
 *   ```cmcc
 *   +save|event|在避难所里冻了一夜
 *   +shared|fact|USER 怕冷
 *   ```
 *
 * scope:  save（当前存档，默认） | world（整个当前世界） | shared（跨越所有世界）
 * kind:   event | fact | rel | meta | pref   （仅作分类，可省）
 *
 * 设计取向：
 *   · 解析失败**绝不抛错** —— 返回 { entries: [], errors: [...] }，正文照常显示
 *   · 宽松匹配：代码块语言标记大小写不敏感，也认 memo / memory / CMCC
 *   · 只读取，不修改正文（ST 的「正则」扩展负责把块从显示里去掉）
 */

export const BLOCK_LANG = 'cmcc';
const LANG_RE = /^\s*(cmcc|memo|memory|cmcc_memory)\s*$/i;

/** 一次最多接受多少条（防止模型刷屏把记忆写爆） */
export const MAX_ENTRIES_PER_BLOCK = 20;
/** 单条记忆最大长度 */
export const MAX_TEXT_LEN = 500;

const VALID_SCOPE = new Set(['save', 'world', 'shared']);
const OP_ADD = new Set(['+', 'add', '', '+save', '+world', '+shared']);

/**
 * 从一段 AI 正文里抽出所有 cmcc 代码块的内容
 * @param {string} text
 * @returns {string[]} 块内文本（不含围栏）
 */
export function extractBlocks(text) {
    if (!text || typeof text !== 'string') return [];
    const out = [];

    // ① 首选：HTML 折叠块 <details class="cmcc">…</details>
    //    它的好处是渲染成可折叠卡片（美观看得见），又能随时展开查看，
    //    比代码块干净 —— 代码块在酒馆里就是一大段等宽文字。
    const dre = /<details[^>]*\bcmcc\b[^>]*>([\s\S]*?)<\/details>/gi;
    let d;
    while ((d = dre.exec(text)) !== null) out.push(d[1]);

    // ② 兼容：```cmcc 代码块（旧格式，AI 可能还在用）
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (LANG_RE.test(m[1])) out.push(m[2]);
    }
    return out;
}

/** 去掉正文里的 cmcc 代码块（备用：若用户没装正则） */
export function stripBlocks(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/<details[^>]*\bcmcc\b[^>]*>[\s\S]*?<\/details>/gi, '')
        .replace(/```([^\n`]*)\n[\s\S]*?```/g, (whole, lang) =>
            (LANG_RE.test(lang) ? '' : whole))
        .replace(/\n{3,}/g, '\n\n').trim();
}

/** 单条记忆的规范化 */
function normalizeEntry(raw) {
    if (!raw) return null;
    let scope = String(raw.scope || 'save').trim().toLowerCase();
    if (!VALID_SCOPE.has(scope)) scope = 'save';
    let kind = String(raw.kind || '').trim().toLowerCase();
    if (kind && !/^[a-z_]{1,16}$/.test(kind)) kind = '';
    let text = String(raw.text == null ? '' : raw.text).trim();
    if (!text) return null;
    if (text.length > MAX_TEXT_LEN) text = text.slice(0, MAX_TEXT_LEN) + '…';
    return { scope, kind, text };
}

/**
 * 解析一个块的内容 → 记忆条目数组
 * 先试 JSON，不行再试行式。
 */
export function parseBlock(content) {
    const errors = [];
    const entries = [];
    let body = String(content || '').trim();
    // 若块里带了 <summary>标题</summary>，去掉它 —— 标题不是记忆内容
    body = body.replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, '').trim();
    if (!body) return { entries, errors };

    // ── 试 JSON ──
    const jsonText = body.replace(/^[^{\[]*/, '').trim();
    if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
        let obj = null;
        try {
            obj = JSON.parse(jsonText);
        } catch (e) {
            errors.push('JSON 解析失败：' + e.message);
            // 看起来是 JSON 但坏了 —— 不再回落到行式，
            // 否则会把整段 JSON 原文当成一条记忆存进去
            return { entries, errors };
        }
        const arr = Array.isArray(obj) ? obj
            : Array.isArray(obj?.memory) ? obj.memory
                : Array.isArray(obj?.memories) ? obj.memories
                    : null;
        if (!arr) {
            // 同样是「像 JSON 但没有 memory」→ 干净返回空
            errors.push('JSON 里没有 memory 数组');
            return { entries, errors };
        }
        for (const it of arr.slice(0, MAX_ENTRIES_PER_BLOCK)) {
            const e = normalizeEntry(typeof it === 'string' ? { text: it } : it);
            if (e) entries.push(e);
        }
        return { entries, errors };
    }

    // ── 行式 ──
    for (const rawLine of body.split('\n')) {
        let line = rawLine.trim();
        // 去掉可能的 HTML 包装（AI 有时会多包一层 <p> / <br>）
        line = line.replace(/<\/?[a-z][^>]*>/gi, '').replace(/&nbsp;/gi, ' ').trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        // 允许前置 "+" 或 "-"（忽略），然后 scope|kind|text
        let s = line;
        if (s.startsWith('+')) s = s.slice(1);
        else if (s.startsWith('-')) s = s.slice(1);

        const parts = s.split('|');
        if (parts.length >= 3) {
            const e = normalizeEntry({ scope: parts[0], kind: parts[1], text: parts.slice(2).join('|') });
            if (e) entries.push(e);
            else errors.push('条目缺 text：' + line.slice(0, 40));
        } else if (parts.length === 2) {
            // 可能是 scope|text 或 kind|text：第一个词若是 scope 就当 scope
            const p0 = parts[0].trim().toLowerCase();
            const e = VALID_SCOPE.has(p0)
                ? normalizeEntry({ scope: p0, text: parts[1] })
                : normalizeEntry({ kind: p0, text: parts[1] });
            if (e) entries.push(e);
            else errors.push('条目缺 text：' + line.slice(0, 40));
        } else {
            // ★ 新格式：纯文本行，一行一条记忆（不带 scope|kind| 前缀）
            //   顺手剥掉 AI 可能加的编号 / 项目符号
            const plain = s.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim();
            if (!plain) continue;
            const e = normalizeEntry({ scope: 'save', text: plain });
            if (e) entries.push(e);
        }
        if (entries.length >= MAX_ENTRIES_PER_BLOCK) break;
    }

    return { entries, errors };
}

/**
 * 从整段 AI 回复里解析出所有记忆指令
 * @param {string} text AI 回复全文
 * @returns {{entries: Array, errors: string[], blockCount: number}}
 */
export function parseMemoryCommands(text) {
    const blocks = extractBlocks(text);
    const entries = [];
    const errors = [];
    for (const b of blocks) {
        const r = parseBlock(b);
        entries.push(...r.entries);
        errors.push(...r.errors);
    }
    // 全局上限
    if (entries.length > MAX_ENTRIES_PER_BLOCK) {
        errors.push(`一次输出 ${entries.length} 条，只取前 ${MAX_ENTRIES_PER_BLOCK} 条`);
        entries.length = MAX_ENTRIES_PER_BLOCK;
    }
    return { entries, errors, blockCount: blocks.length };
}

/** 给 prompt 用的格式说明（拼进引导文本） */
export function commandSpec() {
    return [
        '【每次生成正文后，在最后追加一个记忆块】',
        '',
        '格式（严格照抄）：',
        '',
        '<details class="cmcc"><summary>本次记忆</summary>',
        '第一条记忆，30~50 字，写清楚谁、在哪、做了什么、结果如何',
        '第二条记忆，同样 30~50 字',
        '</details>',
        '',
        '规则：',
        '- 只在**确实有值得记的事**时才输出这个块；没有就不输出（不要硬凑）。',
        '- **一行一条记忆，直接写内容**。不要加前缀、不要编号、不要写范围。',
        '  你是不是在哪个存档、哪个世界，插件会自己记，不用你写。',
        '- 每条 30~50 字，要有具体细节，不要写成"发生了某事"这种空话。',
        '- 用你自己的视角叙述，省略主语（"我"不用写出来）。',
        '- 优先记录：地点变化、遇到的人、关键事件、与 {user} 之间的互动。',
        '- 最多 5 条，只写重要的，不要复述整段剧情。',
        '- 这个块是给你自己留的备忘，正文里**不要提到它**。',
    ].join('\n');
}
