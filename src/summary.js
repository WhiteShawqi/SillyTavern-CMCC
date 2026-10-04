/**
 * CMCC · 读取「预设自带的摘要」作为记忆来源
 *
 * 背景（用户的想法，比让 AI 另写一份好）：
 *   他的预设里已经有一条指令，AI 每次正文后都会输出：
 *
 *     <summary_format>
 *     每次正文结束后，紧跟着进行一段对于本次互动的正文的摘要
 *     <summary>用约150字概括本条回复的具体事件…</summary>
 *     </summary_format>
 *
 *   而且预设自带正则把它渲染成折叠卡片：
 *     findRegex:     /(?<!<details>\s*)<summary>(…)<\/summary>/gi
 *     replaceString: <details><summary>摘要</summary>\n$1\n</details>
 *
 *   所以**不需要再让 AI 写一份记忆块** —— 直接读那个摘要即可。
 *   这既省 token（不用重复输出），又不会在正文里多出一个块。
 *
 * ⚠ 关键点：预设的正则装了负向后行断言 `(?<!<details>\s*)`，
 *   意思是「不是 <details> 后面的 <summary>」才匹配。
 *   所以**已经渲染过的**摘要是 `<details><summary>摘要</summary>…</details>` 形态，
 *   而**刚生成的原始文本**才是裸的 `<summary>…</summary>`。
 *   两种形态都要能读到。
 */

/**
 * 从一段文本里抽出「摘要」内容
 * @param {string} text AI 回复原文
 * @returns {string} 摘要正文（可能有多段，已用换行连接）；没有则空串
 */
export function extractPresetSummary(text) {
    if (!text || typeof text !== 'string') return '';

    const parts = [];

    // ① 已渲染形态：<details><summary>摘要</summary> … </details>
    //    标题可能是「摘要」，也可能是别的（兼容几种写法）
    const rendered = /<details[^>]*>\s*<summary[^>]*>\s*(?:摘要|概要|总结|summary)\s*<\/summary>([\s\S]*?)<\/details>/gi;
    let m;
    while ((m = rendered.exec(text)) !== null) {
        const body = cleanSummaryBody(m[1]);
        if (body) parts.push(body);
    }
    if (parts.length) return parts.join('\n');

    // ② 原始形态：裸的 <summary>…</summary>
    //    用负向后行断言跳过紧跟 <details> 的那种（那是折叠标题，不是内容）
    const raw = /(?<!<details[^>]{0,40}>)\s*<summary[^>]*>([\s\S]*?)<\/summary>/gi;
    while ((m = raw.exec(text)) !== null) {
        const body = cleanSummaryBody(m[1]);
        if (body) parts.push(body);
    }

    return parts.join('\n');
}

/** 清掉摘要正文里的 HTML 与多余空白 */
function cleanSummaryBody(s) {
    return String(s || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')          // 其余标签直接去掉
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

/**
 * 把一段 150 字的摘要切成若干条记忆
 *
 * 预设的摘要是一整段（约 150 字），而我们的记忆模型是「一条一件事」。
 * 所以按句子切：中文句末标点（。！？；）和换行都算边界，
 * 太短的句子并入上一条，太长的（超过 ~80 字）按逗号再切一刀。
 *
 * @param {string} summary
 * @param {{max?:number, minLen?:number}} [opts]
 * @returns {string[]} 句子数组
 */
export function splitSummary(summary, { max = 8, minLen = 8 } = {}) {
    const s = String(summary || '').trim();
    if (!s) return [];

    // 先按句末标点切（保留标点）
    const rawSents = s
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=[。！？；!?;])/))
        .map((x) => x.trim())
        .filter(Boolean);

    // 合并过短的片段（避免"他笑了。"这种碎片单独成条）
    const merged = [];
    for (const sent of rawSents) {
        const last = merged[merged.length - 1];
        if (last && (last.length < minLen || sent.length < minLen)) {
            // 太短就并进上一条（但如果并完太长就另起）
            if (last.length + sent.length <= 120) {
                merged[merged.length - 1] = last + sent;
                continue;
            }
        }
        merged.push(sent);
    }

    // 过长的再按逗号切一刀
    const out = [];
    for (const sent of merged) {
        if (sent.length <= 80) { out.push(sent); continue; }
        const chunks = sent.split(/(?<=[，,])/).map((x) => x.trim()).filter(Boolean);
        let buf = '';
        for (const c of chunks) {
            if (buf && (buf + c).length > 80) { out.push(buf.trim()); buf = c; }
            else buf += c;
        }
        if (buf.trim()) out.push(buf.trim());
    }

    return out.slice(0, max);
}

/** 给 prompt 用的说明：告诉 AI 摘要会被当作记忆 */
export function summaryHint() {
    return [
        '【关于你每次写的 <summary> 摘要】',
        '那个摘要会被当作**你的长期记忆**存下来，不只是一次性的总结。',
        '所以写摘要时请注意：',
        '- 忠实记录**具体事件**：谁、在哪、做了什么、结果如何。',
        '- 保留关键对白与情报（你以后要靠它回忆）。',
        '- 不要写"发生了很多事""气氛微妙"这类空话。',
        '- 约 150 字，可以写成两三句话。',
    ].join('\n');
}
