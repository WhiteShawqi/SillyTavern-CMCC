/**
 * 导出 / 导入的**纯逻辑**（不碰 DOM、不碰网络、不碰世界书）
 *
 * 抽出来的原因：原来这两段写在 index.js 的 api 对象里，
 * 依赖 settings / CACHE / saveToBook / panel / toastr，
 * 没法单独测 —— 而"导入别人的预设"正是最容易出错、又最该测的地方。
 * 现在这里是纯函数，index.js 只负责调用 + 落盘 + 刷新界面。
 */

/**
 * 构造导出对象
 * @param {object} o
 * @param {object} o.persona  人设 {name,description,personality,scenario}
 * @param {object} o.worlds   记忆模型（worlds 表）
 * @param {string} [o.manifestVersion]
 * @returns {object}
 */
export function buildExport({ persona, worlds, manifestVersion = '' }) {
    return {
        _cmcc: true,
        _version: 1,
        exportedAt: new Date().toISOString(),
        manifestVersion,
        persona: persona ? {
            name: persona.name || '',
            description: persona.description || '',
            personality: persona.personality || '',
            scenario: persona.scenario || '',
        } : null,
        // 深拷贝，避免导出后被继续修改
        worlds: JSON.parse(JSON.stringify(worlds || {})),
    };
}

/**
 * 校验一个对象是不是 CMCC 导出的
 * @param {object} obj
 * @returns {{ok:boolean, error?:string}}
 */
export function validateImport(obj) {
    if (!obj || typeof obj !== 'object') {
        return { ok: false, error: '不是有效的 JSON 对象' };
    }
    if (!obj._cmcc) {
        return { ok: false, error: '不是 CMCC 导出的文件（缺少 _cmcc 标记）' };
    }
    if (!obj.persona && !obj.worlds) {
        return { ok: false, error: '文件里既没有人设也没有记忆' };
    }
    return { ok: true };
}

/**
 * 统计一份导出对象里有多少条记忆
 * @param {object} obj
 * @returns {number}
 */
export function countEntries(obj) {
    let n = 0;
    for (const w of Object.values(obj?.worlds || {})) {
        for (const s of Object.values(w?.saves || {})) {
            n += (s?.entries || []).length;
        }
    }
    return n;
}

/**
 * 把导入的人设并进设置（纯逻辑，不落盘）
 *
 * @param {object} settings        会被就地修改
 * @param {object|null} persona    导入的人设
 * @param {boolean} asNewPersona   true=作为新预设追加；false=覆盖当前激活项
 * @param {() => string} makeId    生成 id 的函数
 * @returns {string} 实际生效的人设名（空串表示没导入人设）
 */
export function mergePersona(settings, persona, asNewPersona, makeId) {
    if (!persona || !persona.name) return '';

    const clean = {
        name: String(persona.name || ''),
        description: String(persona.description || ''),
        personality: String(persona.personality || ''),
        scenario: String(persona.scenario || ''),
    };

    settings.builtins = Array.isArray(settings.builtins) ? settings.builtins : [];

    if (asNewPersona) {
        const item = Object.assign({ id: String(makeId()) }, clean);
        settings.builtins.push(item);
        settings.activeBuiltinId = item.id;
    } else {
        // 覆盖当前激活项；没有就追加一个
        let target = settings.builtins.find((x) => x.id === settings.activeBuiltinId);
        if (!target) {
            target = Object.assign({ id: String(makeId()) }, clean);
            settings.builtins.push(target);
            settings.activeBuiltinId = target.id;
        } else {
            Object.assign(target, clean);
        }
    }
    settings.personaMode = 'builtin';
    // 兼容旧字段：builtin 始终镜像当前激活项
    const active = settings.builtins.find((x) => x.id === settings.activeBuiltinId)
        || settings.builtins[settings.builtins.length - 1];
    settings.builtin = Object.assign({}, active);
    return clean.name;
}

/**
 * 把导入的记忆并进记忆模型（纯逻辑，不落盘）
 *
 * 合并策略：**按内容去重追加**，绝不覆盖已有的。
 * 同一个 (世界, 存档) 已存在的条目按文字去重；
 * 世界或存档不存在就建出来。
 *
 * @param {object} worlds  会被就地修改（worlds 表）
 * @param {object} incoming  导入对象里的 worlds
 * @param {number} [now]
 * @returns {{worlds:number, saves:number, entries:number, skipped:number}}
 */
export function mergeWorlds(worlds, incoming, now = Date.now()) {
    const stat = { worlds: 0, saves: 0, entries: 0, skipped: 0 };
    if (!worlds || !incoming || typeof incoming !== 'object') return stat;

    for (const [wKey, w] of Object.entries(incoming)) {
        if (!w || typeof w !== 'object') continue;

        if (!worlds[wKey]) {
            worlds[wKey] = { label: w.label || wKey, lastSeen: now, saves: {} };
            stat.worlds++;
        }
        const dst = worlds[wKey];
        if (w.label) dst.label = w.label;
        if (!dst.saves || typeof dst.saves !== 'object') dst.saves = {};

        for (const [sKey, sv] of Object.entries(w.saves || {})) {
            if (!sv || typeof sv !== 'object') continue;

            if (!dst.saves[sKey]) {
                dst.saves[sKey] = {
                    label: sv.label || sKey,
                    firstSeen: sv.firstSeen || now,
                    lastSeen: sv.lastSeen || now,
                    entries: [],
                };
                stat.saves++;
            }
            const target = dst.saves[sKey];
            if (!Array.isArray(target.entries)) target.entries = [];
            if (sv.lastSeen && sv.lastSeen > (target.lastSeen || 0)) target.lastSeen = sv.lastSeen;

            const have = new Set(target.entries.map((e) => e && e.text));
            for (const e of (sv.entries || [])) {
                if (!e || typeof e.text !== 'string' || !e.text) { stat.skipped++; continue; }
                if (have.has(e.text)) { stat.skipped++; continue; }   // 去重
                have.add(e.text);
                target.entries.push({
                    ts: e.ts || now,
                    text: e.text,
                    kind: e.kind || 'memo',
                });
                stat.entries++;
            }
        }
    }
    return stat;
}
