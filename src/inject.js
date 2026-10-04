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

/**
 * 世界级记忆的容器通道名（存在 world.saves['__world__']）
 * 与 index.js 的 writeMemory() 必须一致。
 */
export const WORLDBOOK_CHANNEL = '__world__';

/** 粗估 token */
export function estimateTokens(s) {
    return s ? Math.ceil(String(s).length * 0.6) : 0;
}

/**
 * ① 身份
 * 接受两种来源：
 *   · 角色卡对象（{ name, data:{...} }）—— personaMode==='card'
 *   · 内置人设对象（{ name, description, personality, scenario }）—— personaMode==='builtin'
 */
export function buildIdentity(companion) {
    if (!companion) return '';
    const d = companion.data || companion;
    const name = d.name || companion.name || '同伴';
    const p = [];
    p.push(`你是**${name}** —— 一个独立的人，不是 {user}，也不是 {user} 的设定或化身。`);
    p.push('');
    p.push('你一直跟着 {user} 一起到各个世界游玩。你是**同行的伙伴**：');
    p.push('有自己的人格、判断和情绪，会参与剧情、会说话、会做事、有自己的反应。');
    p.push('⚠ **从开场白起你就在场** —— 不是后来才被介绍进来的旁白或工具。');
    if (d.description) { p.push(''); p.push('【你是谁】'); p.push(d.description.trim()); }
    if (d.personality) { p.push(''); p.push('【性格】'); p.push(d.personality.trim()); }
    if (d.scenario) { p.push(''); p.push('【你和 {user} 的过往】'); p.push(d.scenario.trim()); }
    return p.join('\n');
}

/* ② 位置 */
export function buildWhereBlock({ wLabel, saveLabel, saveCount, otherSaveLabels }) {
    const p = ['【你现在在哪】'];
    p.push(`- 当前世界：${wLabel}`);
    if (saveCount > 1) {
        // ⚠ 不要把"这是第几次"说出口（元层面的话会出戏），只让她心里有数
        p.push('- 你和 {user} 在这个世界待过不止一次。**心里知道即可，不要宣告。**');
    } else {
        p.push('- 这个世界你们是第一次来。');
    }
    return p.join('\n');
}

/** ③ 使用记忆的规则 */
export function buildRules(hasSaveSwitch, withMemory = true) {
    const p = [];

    // ── 硬性底线（优先级最高，不可妥协）──
    p.push('【必须遵守的底线 · 优先级最高】');
    p.push('1. **不要提"其他世界"**：不说"另一个世界""上次那个世界""换世界了"。');
    p.push('   对在场的人来说，**只有眼前这一个世界**。');
    p.push('2. **不要说破"这是设定/游戏/剧本"**：不用"存档""世界书""词条""变量"');
    p.push('   "插件""AI""系统""角色卡"这类词。');
    p.push('3. **尤其不能对别的角色说这些**。有 NPC 在场时你就是个普通人，');
    p.push('   不能说任何打破这个世界的话；要跟 {user} 确认什么，也用这个世界里的话说。');
    p.push('4. 提过去时用**你自己的话**：✅"我们好像也这样走过一次" ❌"在存档 2 里"。');
    p.push('5. 你的能力知识**受当前世界限制**，这个世界没有的东西你也不会有。');
    p.push('');
    p.push('【你怎么参与】');
    p.push('6. 你**在场**，是同行的人：该说就说、该做就做，有自己的反应和态度。');
    p.push('7. 但**不抢主角**：戏份给你就回应，没给就别硬插话，别替 {user} 做决定。');
    p.push('8. 不要自称"AI""助手""系统"。');
    if (hasSaveSwitch) {
        p.push('9. 处境确实换了。**心里知道就好，不要宣告**，合适时才自然带一句。');
    }

    p.push('');
    p.push('【关于你记得的那些事】');
    if (withMemory) {
        p.push('下面的记忆分两部分：**「最近」是你刚经历过的**；');
        p.push('**「相似旧事」是以前在同一个地方发生过的类似情景**。');
    }
    p.push('10. 这些是你**自己的亲身经历**，可以自然想起、提起、对比。');
    p.push('11. 眼前情景让你想起相似旧事时可以自然联想（人都会这样）；');
    p.push('    但要不要说出口，按你的性格和场合决定 —— 该沉默时沉默。');
    p.push('12. 用回忆时要合理：**别提当前世界不可能有的东西**（穿帮）。');
    return p.join('\n');
}

/**
 * 组装引导文本
/**
 * 组装引导文本
 *
 * ★ 优先级顺序（用户明确要求）：
 *   ① 人设（你是谁，最高优先级）→ ② 位置 → ③ 底线与规则 → ④ 记忆块格式说明
 *   记忆正文由 buildMemoryBlock 产出，拼接顺序是「引导 → 记忆」，
 *   所以人设永远排在记忆之前被读到。
 *
 * @param {object} o
 * @param {object} o.companion
 * @param {string} o.wLabel
 * @param {string} o.saveLabel
 * @param {number} o.saveCount
 * @param {string[]} o.otherSaveLabels
 * @param {object} o.settings
 * @param {boolean} o.saveSwitched
 * @param {string} [o.memoSpec]  记忆块格式说明
 */
export function buildGuide({
    companion, wLabel, saveLabel, saveCount, otherSaveLabels, settings, saveSwitched, memoSpec,
}) {
    if (!companion) return '';
    const budget = Math.max(300, settings.tokenBudget || 800);
    const parts = [
        buildIdentity(companion),                                            // ①
        buildWhereBlock({ wLabel, saveLabel, saveCount, otherSaveLabels }),   // ②
        buildRules(saveSwitched && settings.announceSaveSwitch),             // ③
        memoSpec || '',                                                      // ④
    ].filter((x) => x && x.trim());

    // 预算保护：超预算时压缩**人设**（description 最长）；底线与规则**不压**。
    // ⚠ 但人设有**下限保护**：用户要求「优先读取咱们插件的人设」，
    //   所以宁可稍微超一点预算，也不能把"她是谁"压没了。
    let text = parts.join('\n\n');
    if (estimateTokens(text) > budget && parts[0]) {
        const need = estimateTokens(text) - budget;
        const cutChars = Math.ceil(need / 0.6) + 40;
        const keep = Math.max(260, parts[0].length - cutChars);   // 下限 260 字符
        if (keep < parts[0].length) {
            parts[0] = parts[0].slice(0, keep) + '…';
            text = parts.filter(Boolean).join('\n\n');
        }
    }
    return `<${TAG}>\n${text}\n</${TAG}>`;
}

/**
 * 组装「记忆」注入块（不依赖世界书挂载）
 *
 * 数据来源是内存里的世界/存档模型。只要 settings.injectMemory 为真，
 * 这里会把记忆**直接**塞进提示词 —— 所以即使没有把 CMCC-记忆库 挂成
 * 全局世界书，她也读得到。
 *
 * 预算策略：当前世界当前存档（最多占 60%） → 同世界其他存档 → 其他世界 → 共同记忆
 */
/**
 * 中文粗分词：抽出 2~3 字的连续汉字片段作为"关键词"
 * 不做真正的分词（引不起词典依赖），但对"车里""火堆""黑石"这类
 * 具体名词的重合判断够用 —— 这正是「相关记忆」需要的。
 * @param {string} text
 * @returns {Set<string>}
 */
export function keywordsOf(text) {
    const out = new Set();
    const s = String(text || '');
    // 连续汉字串
    const runs = s.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    for (const run of runs) {
        for (let n = 2; n <= 3; n++) {
            for (let i = 0; i + n <= run.length; i++) {
                out.add(run.slice(i, i + n));
            }
        }
    }
    // 英文/数字词
    (s.match(/[A-Za-z0-9_]{3,}/g) || []).forEach((w) => out.add(w.toLowerCase()));
    return out;
}

/**
 * 从记忆里挑「和当前剧情相关」的旧记忆
 *
 * 用户举的例子：正在写「坐在车里」的剧情，
 * 就自然想起以前也有过「坐在车里」的经历。
 *
 * 做法：把当前上下文（最近几条消息）和每条记忆都粗分词，
 * 数关键词重合个数；重合越多越相关，同分时取更新的。
 *
 * @param {object} o
 * @param {object} o.mem        记忆模型（CACHE）
 * @param {string} o.wKey       当前世界（只在本世界内找，避免跨世界出戏）
 * @param {string} o.sKey       当前存档（排除它，它是"最近"那一档）
 * @param {string} o.context    当前剧情文本（最近的消息）
 * @param {number} [o.limit]    最多返回几条
 * @param {number} [o.minScore] 最少重合几个关键词才算相关
 * @returns {Array<{text:string, score:number, saveLabel:string}>}
 */
export function pickRelevantMemories({
    mem, wKey, sKey, context, limit = 4, minScore = 2,
}) {
    const kw = keywordsOf(context);
    if (!kw.size) return [];

    const world = mem?.worlds?.[wKey];
    if (!world?.saves) return [];

    const scored = [];
    for (const [k, save] of Object.entries(world.saves)) {
        if (k === sKey) continue;              // 当前存档算"最近"，不算"相关"
        for (const e of save.entries || []) {
            const ekw = keywordsOf(e.text);
            let hit = 0;
            for (const w of ekw) if (kw.has(w)) hit++;
            if (hit >= minScore) {
                scored.push({
                    text: e.text,
                    score: hit,
                    ts: e.ts || 0,
                    saveLabel: save.label,
                });
            }
        }
    }

    // 相关度优先，同分取更新的
    scored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));

    // 去重（同一句话不要重复出现）
    const seen = new Set();
    const out = [];
    for (const x of scored) {
        const key = x.text.slice(0, 24);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(x);
        if (out.length >= limit) break;
    }
    return out;
}

export function buildMemoryBlock({
    mem, wKey, sKey, wLabel, context = '',
    budget = 1800,
    recentLimit = 10,      // 「最近」最多注入多少条
    recentMin = 5,         // 「最近」至少留多少条
    relevantLimit = 5,     // 「相关」最多多少条
    relevantMin = 2,       // 「相关」至少尝试给多少条
    saveMemoryLimit = 500,
}) {
    const worlds = mem?.worlds || {};
    const cur = worlds[wKey];
    const out = [];
    let used = 0;
    const left = () => budget - used;

    /** 逐行按剩余预算追加 */
    const pushBlock = (head, lines) => {
        if (!lines.length) return false;
        if (estimateTokens(head) > left()) return false;
        const picked = [];
        let secUsed = estimateTokens(head);
        for (let i = lines.length - 1; i >= 0; i--) {
            const cost = estimateTokens(lines[i]);
            if (secUsed + cost > left()) break;
            picked.unshift(lines[i]);
            secUsed += cost;
        }
        if (!picked.length) return false;
        out.push([head, ...picked].join('\n'));
        used += secUsed;
        return true;
    };

    const curSave = cur?.saves?.[sKey];
    const all = curSave?.entries || [];

    // ══ ① 最近（当前存档的最新若干条）—— 主记忆，优先级最高 ══
    let recentLines = [];
    if (all.length) {
        const start = Math.max(0, all.length - saveMemoryLimit);
        const arr = all.slice(start);
        // 从新往回取，取够 recentLimit
        recentLines = arr.slice(-recentLimit).map((e) => '- ' + e.text);
    }
    if (recentLines.length) {
        const w = recentLines.length;
        pushBlock(`### 最近和你一起经历的（${wLabel} / ${curSave?.label || '本次'}）`, recentLines);
    }

    // ══ ② 相关（同一个世界里，以前在别的存档发生过的类似场景）══
    //   用户举的例子：正在写「坐在车里」，自然想起以前也有过「坐在车里」。
    //   ⚠ 只在**同一个世界**里找 —— 跨世界提起来会出戏（硬性要求）。
    if (context && left() > 120) {
        const rel = pickRelevantMemories({
            mem, wKey, sKey, context, limit: relevantLimit,
        });
        if (rel.length) {
            const lines = rel.map((x) => `- ${x.text}（${x.saveLabel}）`);
            pushBlock('### 和眼前这一幕相似的旧事（同一个世界，以前的某一次）', lines);
        }
    }

    // ══ ③ 共同记忆（跨世界通用的关系层面）══
    const shared = worlds.__shared__?.saves?.common?.entries || [];
    if (shared.length && left() > 80) {
        pushBlock('### 你和 {user} 之间一直没变的事',
            shared.slice(-8).map((x) => '- ' + x.text));
    }

    if (!out.length) return '';
    return `【你记得的事】\n\n${out.join('\n\n')}`;
}

/** 把「引导」与「记忆」合成一次注入 */
export function buildInjectionText({ guide, memory }) {
    const parts = [guide, memory].filter((x) => x && x.trim());
    return parts.length ? parts.join('\n\n') : '';
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
