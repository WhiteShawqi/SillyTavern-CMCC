/**
 * CMCC · 动态引导注入
 *
 * 架构变更（2026-10-04）：
 *   记忆本体改为存进**世界书**（CMCC-记忆库），由 ST 原生通道注入，
 *   写正文的 AI 直接读得到，用户也能用 ST 的世界书编辑器直接改。
 *
 *   因此动态注入只保留「引导」这一小块：
 *     · 你是谁（角色卡人设，保证一致）
 *     · 我们现在在哪（世界 + 存档 + 玩过几次）
 *     · 怎么用那些记忆（记得一切 / 分清存档 / 别说元语言）
 *
 * 注入点：CHAT_COMPLETION_SETTINGS_READY（已核对 ST 源码 openai.js:3052/3056）
 */

export const TAG = 'cmcc_guide';

/** 粗估 token */
export function estimateTokens(s) {
    return s ? Math.ceil(String(s).length * 0.6) : 0;
}

/** ① 身份（从角色卡取） */
export function buildIdentity(companion) {
    if (!companion) return '';
    const d = companion.data || companion;
    const name = d.name || companion.name || '同伴';
    const p = [`你是 {user} 的**跨世界陪伴者**：${name}。`];
    p.push('你不是这个世界原本的人物 —— 你**一直跟着 {user}**，陪他/她走过很多世界。');
    if (d.description) { p.push(''); p.push(d.description.trim()); }
    if (d.personality) { p.push(''); p.push('【性格】'); p.push(d.personality.trim()); }
    return p.join('\n');
}

/** ② 位置（世界 + 存档） */
export function buildWhereBlock({ wLabel, saveLabel, saveCount, otherSaveLabels }) {
    const p = ['【你现在在哪】'];
    p.push(`- 当前世界：${wLabel}`);
    p.push(`- 当前这次：${saveLabel}`);
    if (saveCount > 1) {
        p.push(`- 这个世界你和 {user} 来过 ${saveCount} 次`);
        if (otherSaveLabels?.length) {
            p.push(`- 另外几次是：${otherSaveLabels.join('、')}`);
        }
        p.push('  ※ 那些是**不同的两次经历**，别和这一次混起来。');
    } else {
        p.push('- 这个世界你们是第一次来。');
    }
    return p.join('\n');
}

/** ③ 使用记忆的规则 */
export function buildRules(hasSaveSwitch) {
    const p = [
        '【关于你记得的那些事】',
        '你的记忆写在世界书里（`[CMCC]` 开头的词条），按世界和「第几次」分好了组。',
        '',
        '1. **你记得一切** —— 别的世界、别的几次游玩发生过的事，都是你自己的亲身经历，',
        '   可以自然地提起、感慨、对比。不是"听说过"，是"我们一起经历过"。',
        '2. **但不要混淆**：不同的世界是不同的地方；同一个世界的不同几次是**不同的经历**。',
        '   提起时要说清是哪一次，别把两件事说成一件。',
        '3. **提及要合人设、看场合** —— 按你的性格来决定要不要提、怎么提。',
        '   该沉默时沉默，别硬往对话里塞回忆。',
        '4. **不要提元语言**：不要说"世界书""词条""变量""存档""设定"这些词。',
        '   你知道自己陪 {user} 去过别处，但要用**你自己的话**讲（比如"上次在那边"）。',
        '5. 你的能力与知识**受当前世界限制**：这个世界没有的东西，你也不会有。',
        '6. 你**在场**但不抢主角：戏份给到你就回应，没给到就别硬插话。',
        '7. 不要自称"AI""助手""系统"。',
    ];
    if (hasSaveSwitch) {
        p.push('');
        p.push('8. 提醒：你们**换到了另一次经历**（换了世界或重开了这个世界的另一段）。');
        p.push('   合适的话可以自然带一句（"这里和上次不一样"），但别生硬地宣告。');
    }
    return p.join('\n');
}

/**
 * 组装引导文本
 * @param {object} o
 * @param {object} o.companion
 * @param {string} o.wLabel
 * @param {string} o.saveLabel
 * @param {number} o.saveCount
 * @param {string[]} o.otherSaveLabels
 * @param {object} o.settings
 * @param {boolean} o.saveSwitched
 */
export function buildGuide({ companion, wLabel, saveLabel, saveCount, otherSaveLabels, settings, saveSwitched }) {
    if (!companion) return '';
    const budget = Math.max(200, settings.tokenBudget || 600);
    const parts = [
        buildIdentity(companion),
        buildWhereBlock({ wLabel, saveLabel, saveCount, otherSaveLabels }),
        buildRules(saveSwitched && settings.announceSaveSwitch),
    ].filter((x) => x && x.trim());

    // 预算保护：规则段是核心，身份段若过长则裁掉 description 的尾部
    let text = parts.join('\n\n');
    if (estimateTokens(text) > budget && parts[0]) {
        const over = estimateTokens(text) - budget;
        const keep = Math.max(120, parts[0].length - Math.ceil(over / 0.6));
        parts[0] = parts[0].slice(0, keep) + '…';
        text = parts.filter(Boolean).join('\n\n');
    }
    return `<${TAG}>\n${text}\n</${TAG}>`;
}

/** 塞进请求体 */
export function injectIntoRequest(generateData, text) {
    if (!generateData || !text) return false;
    const msgs = generateData.messages;
    if (!Array.isArray(msgs)) return false;
    if (msgs.some((m) => typeof m?.content === 'string' && m.content.includes(`<${TAG}>`))) {
        return false;
    }
    const payload = { role: 'system', content: text };
    let idx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === 'user') { idx = i; break; }
    }
    if (idx < 0) msgs.push(payload);
    else msgs.splice(idx, 0, payload);
    return true;
}

export function stripFromMessages(generateData) {
    if (!generateData || !Array.isArray(generateData.messages)) return 0;
    const before = generateData.messages.length;
    generateData.messages = generateData.messages.filter(
        (m) => !(typeof m?.content === 'string' && m.content.includes(`<${TAG}>`)));
    return before - generateData.messages.length;
}
