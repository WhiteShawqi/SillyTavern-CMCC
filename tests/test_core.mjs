/**
 * CMCC · 核心逻辑测试 (v0.3 世界书架构)
 *
 * 覆盖：
 *   ① 世界 / 存档 标识
 *   ② 记忆模型：增删改、重命名存档、重命名世界
 *   ③ 世界书序列化 ↔ 反序列化（往返一致 + 手动改写能读回）
 *   ④ 引导注入：内容、预算、幂等
 *   ⑤ 旧记忆迁移 (localStorage → 世界书模型)
 *
 * 运行：node test_core.mjs
 */
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

const {
    worldKey, worldLabel, saveKey,
    emptyWorld, ensureSave, addMemory, editMemory, deleteMemory,
    renameSave, deleteSave, renameWorld,
    worldStats, bookStats,
    migrateFromLocalStorage, clearLegacyKeys,
    DEFAULT_SETTINGS, normalizeSettings,
} = await import('../src/state.js');

const {
    WORLD_BOOK, C_IDENTITY, C_SHARED, C_PREFIX_WORLD,
    entryTemplate, nextUid, upsertEntry, findEntry, removeEntry,
    serializeWorld, parseWorld, serializeShared, parseShared,
} = await import('../src/store.js');

const {
    buildGuide, injectIntoRequest, stripFromMessages, estimateTokens,
    buildRules, buildWhereBlock, buildMemoryBlock, buildInjectionText, TAG,
} = await import('../src/inject.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ❌ ' + m); };
const chk = (c, m) => (c ? ok(m) : bad(m));
const S = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });

console.log('════ CMCC · 核心逻辑测试 (v0.3) ════');
console.log('');

// ── 1. 标识 ──
console.log('【1】世界 / 存档 标识');
chk(worldKey({ avatar: 'a.png' }) === 'char:a.png', '角色卡世界键');
chk(worldKey({ groupId: 'g1' }) === 'group:g1', '群聊世界键');
chk(worldLabel({ charName: '全球冰封' }) === '全球冰封', '世界标签');
chk(saveKey('chat-1') === 'chat-1', '存档键');
chk(saveKey('') === 'default', '无 chatId 兜底');
console.log('');

// ── 2. 记忆模型 ──
console.log('【2】记忆模型：增删改 / 重命名');
const w = emptyWorld('A世界');
let r = ensureSave(w, 's1');
chk(r.isNew && r.save.label === '存档1', '自动编号「存档1」');
r = ensureSave(w, 's2');
chk(r.save.label === '存档2', '自动编号「存档2」');

addMemory(w, 's1', '在避难所里冻了一夜');
addMemory(w, 's1', '找到一箱罐头');
addMemory(w, 's2', '这次直接进了地堡');
chk(w.saves.s1.entries.length === 2, '存档1 有 2 条');
chk(w.saves.s2.entries.length === 1, '存档2 有 1 条');

chk(editMemory(w, 's1', 0, '改过的第一条') === true, '编辑记忆');
chk(w.saves.s1.entries[0].text === '改过的第一条', '编辑生效');
chk(w.saves.s1.entries[0].kind === 'manual', '编辑后标记为 manual');

chk(deleteMemory(w, 's1', 1) === true, '删除记忆');
chk(w.saves.s1.entries.length === 1, '删除生效');

chk(renameSave(w, 's1', '第一次玩') === true, '重命名存档');
chk(w.saves.s1.label === '第一次玩', '存档名已改');

chk(renameWorld(w, 'A世界(改)') === true, '重命名世界');
chk(w.label === 'A世界(改)', '世界名已改');

chk(deleteSave(w, 's2') === true, '删除存档');
chk(!w.saves.s2, '存档已删');
console.log('');

// ── 3. 世界书序列化 ──
console.log('【3】世界书 序列化 ↔ 反序列化');
const w2 = emptyWorld('全球冰封 v3.1.3');
ensureSave(w2, 'a'); addMemory(w2, 'a', '在避难所里冻了一夜'); addMemory(w2, 'a', '找到一箱罐头');
ensureSave(w2, 'b'); addMemory(w2, 'b', '这次直接进了地堡');
renameSave(w2, 'a', '存档1'); renameSave(w2, 'b', '存档2');

const text = serializeWorld(w2.label, w2.saves);
console.log('      ── 生成的世界书内容 ──');
text.split('\n').forEach((l) => console.log('      ' + l));
console.log('');

chk(text.startsWith('# 全球冰封 v3.1.3'), '一级标题=世界名');
chk(text.includes('## 存档1') && text.includes('## 存档2'), '二级标题=存档名');
chk(text.includes('- 在避难所里冻了一夜'), '记忆用 - 列表');

const back = parseWorld(text);
chk(back.label === '全球冰封 v3.1.3', '往返：世界名一致');
chk(Object.keys(back.saves).length === 2, '往返：2 个存档');
chk(back.saves['存档1'].entries.length === 2, '往返：存档1 有 2 条');
chk(back.saves['存档1'].entries[0].text === '在避难所里冻了一夜', '往返：内容一致');

// 用户手动改写
const handEdited = [
    '# 我改过的世界名',
    '',
    '## 我改的存档名',
    '- 手动加的一条记忆',
    '- 又一条',
    '',
    '## 存档2',
    '- 地堡那次的记忆',
].join('\n');
const hp = parseWorld(handEdited);
chk(hp.label === '我改过的世界名', '★ 手改的世界名能读回');
chk(!!hp.saves['我改的存档名'], '★ 手改的存档名能读回');
chk(hp.saves['我改的存档名'].entries.length === 2, '★ 手加的记忆能读回');
chk(hp.saves['我改的存档名'].entries[0].text === '手动加的一条记忆', '★ 内容正确');

// 空世界
const emptyText = serializeWorld('空的', {});
chk(parseWorld(emptyText).label === '空的', '空世界也能解析');

// 共同记忆
const sh = serializeShared([{ text: 'USER 怕冷' }, { text: '一起走过很多世界' }]);
chk(sh.includes('- USER 怕冷'), '共同记忆序列化');
const shb = parseShared(sh);
chk(shb.length === 2, '共同记忆往返');
chk(parseShared(serializeShared([])).length === 0, '空共同记忆');
console.log('');

// ── 4. 世界书条目操作 ──
console.log('【4】世界书条目操作');
const book = { entries: {} };
const e1 = upsertEntry(book, C_PREFIX_WORLD + 'char:a.png', '内容A');
chk(e1.uid === 0, '首个 uid=0');
chk(!!findEntry(book, C_PREFIX_WORLD + 'char:a.png'), '能按 comment 找到');
const e2 = upsertEntry(book, C_PREFIX_WORLD + 'char:b.png', '内容B');
chk(e2.uid === 1, '第二个 uid=1');
chk(nextUid(book) === 2, '下一个空闲 uid=2');

upsertEntry(book, C_PREFIX_WORLD + 'char:a.png', '内容A改');
chk(Object.keys(book.entries).length === 2, 'upsert 不重复建');
chk(findEntry(book, C_PREFIX_WORLD + 'char:a.png').content === '内容A改', 'upsert 更新内容');

chk(removeEntry(book, C_PREFIX_WORLD + 'char:b.png') === true, '删除条目');
chk(!findEntry(book, C_PREFIX_WORLD + 'char:b.png'), '删除生效');
chk(removeEntry(book, '不存在') === false, '删不存在的返回 false');

const tpl = entryTemplate('测试', '内容', 5);
chk(tpl.constant === true, '模板默认 constant=true（常驻注入）');
chk(tpl.disable === false, '模板默认启用');
chk(tpl.uid === 5 && tpl.displayIndex === 5, 'uid 同步 displayIndex');
console.log('');

// ── 5. 统计 ──
console.log('【5】统计');
const st = worldStats(w2);
chk(st.saveCount === 2, 'worldStats: 2 个存档');
chk(st.count === 3, 'worldStats: 3 条');
const bs = bookStats({ 'char:a.png': w2 });
chk(bs.worldCount === 1 && bs.totalEntries === 3, 'bookStats 汇总');
console.log('');

// ── 6. 引导注入 ──
console.log('【6】引导注入');
const companion = {
    name: '阿米娅',
    data: { name: '阿米娅', description: '罗德岛的领袖，卡特斯族。', personality: '沉稳、温柔。' },
};
const guide = buildGuide({
    companion, wLabel: '全球冰封 v3.1.3', saveLabel: '存档1',
    saveCount: 2, otherSaveLabels: ['存档2'],
    settings: S(), saveSwitched: false,
});
chk(guide.includes(`<${TAG}>`), '带标记');
chk(guide.includes('阿米娅'), '含身份');
chk(guide.includes('罗德岛的领袖'), '含 description');
chk(guide.includes('全球冰封 v3.1.3'), '含当前世界');
chk(guide.includes('存档1'), '含当前存档');
chk(guide.includes('存档2'), '提到另一次经历');
chk(guide.includes('记得一切'), '含「记得一切」');
chk(guide.includes('不要混淆'), '含「不要混淆」');
chk(guide.includes('记忆正文') || guide.includes('按「世界」和「第几次」'), '提到记忆按世界/次数分组');
chk(/人设|合人设/.test(guide), '★ 含「按人设决定是否提及」');
chk(guide.includes('不要说"世界书"') || guide.includes('不要提元语言'), '含禁止元语言');

const g2 = buildGuide({
    companion, wLabel: 'A', saveLabel: 'x', saveCount: 1, otherSaveLabels: [],
    settings: S(), saveSwitched: false,
});
chk(!/来过 \d+ 次/.test(g2), '首次进入不显示"来过 N 次"');

const g3 = buildGuide({
    companion, wLabel: 'A', saveLabel: 'x', saveCount: 1, otherSaveLabels: [],
    settings: S({ announceSaveSwitch: true }), saveSwitched: true,
});
chk(g3.includes('换到了另一次经历'), '★ 换存档时有提示');
chk(!guide.includes('换到了另一次经历'), '非切换时无提示');
console.log('');

// ── 7. 注入请求体 ──
console.log('【7】注入请求体（幂等）');
const gd = { messages: [{ role: 'system', content: 's' }, { role: 'user', content: '你好' }] };
chk(injectIntoRequest(gd, guide) === true, '首次注入');
chk(gd.messages.length === 3, '2 → 3');
chk(gd.messages[1].role === 'system', '插在 user 之前');
chk(gd.messages[2].content === '你好', 'user 仍在最后');
chk(injectIntoRequest(gd, guide) === false, '重复注入被拒');
chk(stripFromMessages(gd) === 1, '可清理');
chk(buildGuide({ companion: null, wLabel: 'x', saveLabel: 'y', saveCount: 1, otherSaveLabels: [], settings: S() }) === '', '无同伴 → 空');
chk(injectIntoRequest(null, guide) === false, '无请求体 → false');

const gd2 = { messages: [{ role: 'system', content: 's' }] };
injectIntoRequest(gd2, guide);
chk(gd2.messages.length === 2, '无 user 消息时追加到末尾');
console.log('');

// ── 8. 预算 ──
console.log('【8】引导预算');
const longComp = {
    name: '很长',
    data: { name: '很长', description: '啊'.repeat(3000), personality: '嗯'.repeat(500) },
};
const smallG = buildGuide({
    companion: longComp, wLabel: 'W', saveLabel: 's', saveCount: 1, otherSaveLabels: [],
    settings: S({ tokenBudget: 400 }), saveSwitched: false,
});
const bigG = buildGuide({
    companion: longComp, wLabel: 'W', saveLabel: 's', saveCount: 1, otherSaveLabels: [],
    settings: S({ tokenBudget: 4000 }), saveSwitched: false,
});
chk(estimateTokens(smallG) < estimateTokens(bigG), '小预算产出更少');
chk(estimateTokens(smallG) <= 400 * 1.5, `小预算受控（约 ${estimateTokens(smallG)}）`);
chk(smallG.includes('记得一切'), '★ 预算紧张时规则段仍保留（核心不能丢）');
console.log('');

// ── 9. 迁移 ──
console.log('【9】旧记忆迁移 (localStorage → 世界书模型)');
store.clear();
localStorage.setItem('cc_memory_v2', JSON.stringify({
    version: 2, companionAvatar: 'old.png',
    worlds: {
        'char:OLD.png': {
            label: '旧世界', firstSeen: 1, lastSeen: 2,
            saves: { s1: { label: '存档1', firstSeen: 1, lastSeen: 2, entries: [{ ts: 1, text: '旧的记忆' }] } },
        },
    },
}));
const leg = migrateFromLocalStorage();
chk(leg !== null, '读到旧记忆');
chk(leg.companionAvatar === 'old.png', '陪伴者保留');
chk(leg.worlds['char:OLD.png'].label === '旧世界', '世界保留');
chk(leg.worlds['char:OLD.png'].saves.s1.entries[0].text === '旧的记忆', '记忆保留');
clearLegacyKeys();
chk(localStorage.getItem('cc_memory_v2') === null, '清理旧键');

// v1 格式
store.clear();
localStorage.setItem('cc_memory_v1', JSON.stringify({
    version: 1, companionAvatar: 'v1.png',
    worlds: { 'char:V1.png': { label: 'V1世界', entries: [{ ts: 1, text: 'v1记忆' }] } },
    meta: [{ ts: 1, text: 'v1羁绊' }],
}));
const leg1 = migrateFromLocalStorage();
chk(leg1.worlds['char:V1.png'].saves.legacy.entries[0].text === 'v1记忆', 'v1 世界记忆迁入存档');

// ── 11. 内置陪伴角色（独立于角色卡库）──
console.log('【11】内置陪伴角色');
const builtin = {
    name: '小满',
    isBuiltin: true,
    data: {
        name: '小满',
        description: '一个总是跟着 {user} 的少女。',
        personality: '话少，但记得每一件小事。',
        scenario: '她不是任何世界的人，只是 {user} 的同伴。',
    },
};
const bg = buildGuide({
    companion: builtin, wLabel: '全球冰封', saveLabel: '存档1',
    saveCount: 1, otherSaveLabels: [], settings: S(), saveSwitched: false,
});
chk(bg.includes('小满'), '内置人设：名字进入引导');
chk(bg.includes('总是跟着'), '内置人设：description 进入引导');
chk(bg.includes('话少'), '内置人设：personality 进入引导');
chk(bg.includes('不是任何世界的人'), '★ 内置人设：scenario 也进入引导（新增）');
console.log('');

// ── 12. 记忆直接注入（不依赖世界书）──
console.log('【12】记忆直接注入');
const memModel = {
    worlds: {
        'char:A.png': {
            label: '全球冰封 v3.1.3', lastSeen: 3, saves: {
                s1: { label: '存档1', lastSeen: 3, entries: [
                    { ts: 1, text: '在避难所里冻了一夜' },
                    { ts: 2, text: '找到一箱罐头' },
                ] },
                s2: { label: '存档2', lastSeen: 2, entries: [{ ts: 3, text: '这次直接进了地堡' }] },
            },
        },
        'char:B.png': {
            label: '漫综：世界观', lastSeen: 1, saves: {
                sx: { label: '存档1', lastSeen: 1, entries: [{ ts: 4, text: '进了万魔殿' }] },
            },
        },
        __shared__: { label: '共同', lastSeen: 1, saves: { common: { label: '共同', entries: [{ ts: 5, text: 'USER 怕冷' }] } } },
    },
};
const mb = buildMemoryBlock({
    mem: memModel, wKey: 'char:A.png', sKey: 's1', wLabel: '全球冰封 v3.1.3',
    budget: 1800,
});
chk(mb.includes('当前位置：全球冰封 v3.1.3 / 存档1'), '★ 标明当前世界与存档');
chk(mb.includes('在避难所里冻了一夜'), '含当前存档记忆');
chk(mb.includes('地堡'), '★ 含同世界其他存档（标为另外一次经历）');
chk(mb.includes('另外一次经历'), '标注了是同世界的另一次');
chk(mb.includes('万魔殿'), '★ 含其他世界的记忆');
chk(mb.includes('USER 怕冷'), '含共同记忆');
chk(!mb.includes('<cmcc_guide>'), '记忆块不带引导标记');

// 预算截断
const big = { worlds: { w: { label: 'W', lastSeen: 1, saves: { s: { label: 's', lastSeen: 1,
    entries: Array.from({ length: 500 }, (_, i) => ({ ts: i, text: '第' + i + '条' + '啊'.repeat(30) })) } } } } };
const mSmall = buildMemoryBlock({ mem: big, wKey: 'w', sKey: 's', wLabel: 'W', budget: 500 });
const mLarge = buildMemoryBlock({ mem: big, wKey: 'w', sKey: 's', wLabel: 'W', budget: 6000 });
chk(estimateTokens(mSmall) <= 750, '小记忆预算受控（约 ' + estimateTokens(mSmall) + '）');
chk(estimateTokens(mSmall) < estimateTokens(mLarge), '小预算产出少于大预算');
chk(mSmall.includes('第499条'), '★ 预算紧张时保留最新记忆');

// 合成
const combo = buildInjectionText({ guide: bg, memory: mb });
chk(combo.includes('<cmcc_guide>'), '合成文本含引导');
chk(combo.includes('在避难所里冻了一夜'), '合成文本含记忆');
chk(combo.indexOf('<cmcc_guide>') < combo.indexOf('在避难所里冻了一夜'), '引导在前、记忆在后');
chk(buildInjectionText({ guide: '', memory: '' }) === '', '全空 → 空字符串');
chk(buildInjectionText({ guide: bg, memory: '' }) === bg, '只有引导时原样返回');
console.log('');

// ── 13. 设置规范化（老配置升级）──
console.log('【13】设置规范化');
const oldCfg = { enabled: true, companionAvatar: 'x.png' };
const norm = normalizeSettings(oldCfg);
chk(norm.personaMode === 'builtin', '★ 老配置默认升级为 builtin 模式');
chk(!!norm.builtin && norm.builtin.name === '同伴', '补齐 builtin 字段');
chk(norm.companionAvatar === 'x.png', '保留原有设置');
chk(norm.injectMemory === true, '补齐 injectMemory');
chk(norm.memoryBudget === 1800, '补齐 memoryBudget');

console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail ? 1 : 0);
