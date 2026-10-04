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
    const p = [`你是 {user} 的**跨世界陪伴者**：${name}。`];
    p.push('你不是这个世界原本的人物 —— 你**一直跟着 {user}**，陪他/她走过很多世界。');
    if (d.description) { p.push(''); p.push(d.description.trim()); }
    if (d.personality) { p.push(''); p.push('【性格】'); p.push(d.personality.trim()); }
    if (d.scenario) { p.push(''); p.push('【你与 {user} 的关系】'); p.push(d.scenario.trim()); }
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
export function buildRules(hasSaveSwitch, withMemory = true) {
    const p = ['【关于你记得的那些事】'];
    p.push(withMemory
        ? '下面是你的记忆正文，已按「世界」和「第几次」分好组。'
        : '你会收到按「世界」和「第几次」分组的记忆。');
    p.push('');
    p.push('1. **你记得一切** —— 别的世界、别的几次游玩发生过的事，都是你自己的亲身经历，');
    p.push('   可以自然地提起、感慨、对比。不是"听说过"，是"我们一起经历过"。');
    p.push('2. **但不要混淆**：不同的世界是不同的地方；同一个世界的不同几次是**不同的经历**。');
    p.push('   提起时要说清是哪一次，别把两件事说成一件。');
    p.push('3. **提及要合人设、看场合** —— 按你的性格来决定要不要提、怎么提。');
    p.push('   该沉默时沉默，别硬往对话里塞回忆。');
    p.push('4. **不要提元语言**：不要说"世界书""词条""变量""存档""设定"这些词。');
    p.push('   你知道自己陪 {user} 去过别处，但要用**你自己的话**讲（比如"上次在那边"）。');
    p.push('5. 你的能力与知识**受当前世界限制**：这个世界没有的东西，你也不会有。');
    p.push('6. 你**在场**但不抢主角：戏份给到你就回应，没给到就别硬插话。');
    p.push('7. 不要自称"AI""助手""系统"。');
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
export function buildGuide({
    companion, wLabel, saveLabel, saveCount, otherSaveLabels, settings, saveSwitched, memoSpec,
}) {
    if (!companion) return '';
    const budget = Math.max(200, settings.tokenBudget || 600);
    const parts = [
        buildIdentity(companion),
        buildWhereBlock({ wLabel, saveLabel, saveCount, otherSaveLabels }),
        buildRules(saveSwitched && settings.announceSaveSwitch),
        memoSpec || '',
    ].filter((x) => x && x.trim());

    // 预算保护：规则段与记忆块说明是核心，身份段若过长则裁掉 description 的尾部
    let text = parts.join('\n\n');
    if (estimateTokens(text) > budget && parts[0]) {
        const over = estimateTokens(text) - budget;
        const keep = Math.max(120, parts[0].length - Math.ceil(over / 0.6));
        parts[0] = parts[0].slice(0, keep) + '…';
        text = parts.filter(Boolean).join('\n\n');
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
export function buildMemoryBlock({
    mem, wKey, sKey, wLabel,
    budget = 1800, saveLimit = 500, otherLimit = 8,
}) {
    const worlds = mem?.worlds || {};
    const cur = worlds[wKey];
    const out = [];
    let used = 0;

    /** 剩余预算 */
    const left = () => budget - used;
    /**
     * 按总预算追加，**逐行**直到放不下为止。
     * 不能整块判：一块超预算就整块丢掉，会让预算紧张时一条都留不下。
     * @returns {boolean} 是否至少放进去一行
     */
    const pushBlock = (head, lines) => {
        if (!lines.length) return false;
        if (estimateTokens(head) > left()) return false;
        const picked = [];
        let secUsed = estimateTokens(head);
        // 从最新往回取（记忆越近越相关）
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

    // ① 当前世界 · 当前存档（最相关，最多吃 60% 预算）
    // 世界级记忆（存在 __world__ 通道里）先于存档记忆给出，但占用同一段预算
    const CH = WORLDBOOK_CHANNEL;
    const worldEntries = cur?.saves?.[CH]?.entries || [];
    const curSave = cur?.saves?.[sKey];
    if ((worldEntries.length || curSave?.entries?.length)) {
        const head = curSave
            ? `### 当前位置：${wLabel} / ${curSave.label}`
            : `### 当前位置：${wLabel}`;
        const picked = [];
        const cap = Math.max(120, budget * 0.6);
        let secUsed = estimateTokens(head);

        const take = (line) => {
            const cost = estimateTokens(line);
            if (secUsed + cost > cap) return false;
            picked.push(line);
            secUsed += cost;
            return true;
        };

        // 世界级：整个世界通用，换存档也成立 → 从旧到新全给
        if (worldEntries.length) {
            picked.push('（这个世界的常识，换哪一次都成立）');
            secUsed += estimateTokens(picked[picked.length - 1]);
            for (const e of worldEntries) {
                if (!take('- ' + e.text)) break;
            }
        }
        // 存档级：越新越相关 → 从新往回取
        if (curSave?.entries?.length) {
            const arr = curSave.entries;
            const start = Math.max(0, arr.length - saveLimit);
            const lines = [];
            let rest = secUsed;
            for (let i = arr.length - 1; i >= start; i--) {
                const line = '- ' + arr[i].text;
                const cost = estimateTokens(line);
                if (rest + cost > cap) break;
                lines.unshift(line);
                rest += cost;
            }
            if (lines.length) {
                if (worldEntries.length) {
                    picked.push('（这一次发生的事）');
                    secUsed += estimateTokens(picked[picked.length - 1]);
                }
                picked.push(...lines);
                secUsed = rest;
            }
        }
        if (picked.length) {
            out.push([head, ...picked].join('\n'));
            used += secUsed;
        }
    }

    // ② 同一个世界的其他存档
    if (cur && cur.saves) {
        for (const [k, s] of Object.entries(cur.saves)) {
            if (k === sKey || k === CH) continue;   // 跳过当前存档与世界通道
            const lines = (s.entries || []).slice(-4).map((x) => '- ' + x.text);
            if (!pushBlock(`### ${wLabel} / ${s.label}（另外一次经历）`, lines)) break;
        }
    }

    // ③ 其他世界
    const others = Object.entries(worlds)
        .filter(([k]) => k !== wKey && k !== '__shared__')
        .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
    for (const [, w] of others) {
        const all = Object.values(w.saves || {})
            .flatMap((s) => (s.entries || []).map((e) => ({ ...e })))
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        const lines = all.slice(-otherLimit).map((x) => '- ' + x.text);
        if (!pushBlock(`### ${w.label}（你去过的地方）`, lines)) break;
    }

    // ④ 共同记忆
    const shared = worlds.__shared__?.saves?.common?.entries || [];
    if (shared.length) {
        pushBlock('### 你和 {user} 之间一直没变的事',
            shared.slice(-8).map((x) => '- ' + x.text));
    }

    if (!out.length) return '';
    return `【你记得的事（按世界和「第几次」分好了组）】\n\n${out.join('\n\n')}`;
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
