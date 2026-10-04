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
    deleteMemories, clearByScope, purgeEmpty,
} = await import('../src/state.js');

const {
    WORLD_BOOK, C_IDENTITY, C_SHARED, C_PREFIX_WORLD,
    entryTemplate, nextUid, upsertEntry, findEntry, removeEntry,
    serializeWorld, parseWorld, serializeShared, parseShared,
} = await import('../src/store.js');

const {
    buildGuide, injectIntoRequest, stripFromMessages, estimateTokens,
    buildRules, buildWhereBlock, buildMemoryBlock, buildInjectionText, TAG,
    WORLDBOOK_CHANNEL,
} = await import('../src/inject.js');
const CH = WORLDBOOK_CHANNEL;

const {
    extractPresetSummary, splitSummary, summaryHint,
} = await import('../src/summary.js');

const {
    extractBlocks, stripBlocks, parseBlock, parseMemoryCommands, commandSpec,
    BLOCK_LANG, MAX_ENTRIES_PER_BLOCK, MAX_TEXT_LEN,
} = await import('../src/memo.js');

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
chk(saveKey('') === null, '★ 无 chatId 返回 null（不再建 default 存档）');
chk(saveKey(null) === null, 'null chatId → null');
chk(saveKey('   ') === null, '★ 纯空白 → null');
chk(saveKey('chat-1') === 'chat-1', '有效 chatId 正常返回');
chk(saveKey(123) === '123', '数字也转成字符串');
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


// ── 14. MVU 式记忆块解析 ──
console.log('【14】记忆块解析');
const fenced = '正文写完了。\n\n```' + BLOCK_LANG + '\n+save|event|在避难所里冻了一夜\n+shared|fact|USER 怕冷\n```\n';
const bl = extractBlocks(fenced);
chk(bl.length === 1, '抽出一个 cmcc 代码块');
chk(bl[0].includes('避难所'), '块内容正确');

// 语言标记大小写/别名
chk(extractBlocks('x\n```CMCC\n+save|a|b\n```').length === 1, '语言标记大小写不敏感');
chk(extractBlocks('x\n```memo\n+save|a|b\n```').length === 1, '认 memo 别名');
chk(extractBlocks('x\n```js\nvar a=1;\n```').length === 0, '★ 不误吃普通代码块');
chk(extractBlocks('没有代码块').length === 0, '无块返回空');
chk(extractBlocks('').length === 0, '空串安全');
chk(extractBlocks(null).length === 0, 'null 安全');

// 行式
const r1 = parseBlock('+save|event|找到一箱罐头');
chk(r1.entries.length === 1, '行式：1 条');
chk(r1.entries[0].scope === 'save', '行式：scope 正确');
chk(r1.entries[0].kind === 'event', '行式：kind 正确');
chk(r1.entries[0].text === '找到一箱罐头', '行式：text 正确');

const r2 = parseBlock('+world|fact|这世界有一种黑石\n+shared|rel|她一直跟着你');
chk(r2.entries.length === 2, '行式：多行');
chk(r2.entries[1].scope === 'shared', '行式：第二条 scope 正确');

chk(parseBlock('+save|只有两段').entries[0].scope === 'save', '两段按 save 处理');
chk(parseBlock('+save|只有两段').entries[0].text === '只有两段', '两段：text 取第二段');
chk(parseBlock('就一段话').entries[0].text === '就一段话', '★ 单段也认（按 save）');
chk(parseBlock('就一段话').entries[0].scope === 'save', '单段默认 save');

// 非法/边界
chk(parseBlock('+bad|event|内容').entries[0].scope === 'save', '★ 非法 scope 回落 save');
chk(parseBlock('# 注释\n// 也是注释\n+save|a|真的').entries.length === 1, '跳过注释行');
chk(parseBlock('').entries.length === 0, '空块无条目');
chk(parseBlock('   \n  ').entries.length === 0, '空白块无条目');
chk(parseBlock('+save|event|').entries.length === 0, '空 text 被丢弃');
chk(parseBlock('-save|event|减号也认').entries[0].text === '减号也认', '前缀 - 也接受');

const longText = '+save|event|' + 'x'.repeat(MAX_TEXT_LEN + 200);
chk(parseBlock(longText).entries[0].text.length <= MAX_TEXT_LEN + 1, '★ 超长 text 被截断');

const many = Array.from({ length: 50 }, (_, i) => '+save|e|第' + i).join('\n');
chk(parseBlock(many).entries.length === MAX_ENTRIES_PER_BLOCK, '★ 单块条数上限生效');

// JSON 格式
const j1 = parseBlock('{"memory":[{"scope":"world","kind":"fact","text":"黑石"}]}');
chk(j1.entries.length === 1, 'JSON：1 条');
chk(j1.entries[0].scope === 'world', 'JSON：scope 正确');
chk(j1.entries[0].text === '黑石', 'JSON：text 正确');
chk(parseBlock('[{"text":"裸数组"}]').entries[0].text === '裸数组', 'JSON：裸数组也认');
chk(parseBlock('{"memory":["纯字符串"]}').entries[0].text === '纯字符串', 'JSON：字符串条目');
chk(parseBlock('{"别的":1}').entries.length === 0, '★ JSON 无 memory 字段 → 无条目');
chk(parseBlock('{坏 json').entries.length >= 0, '★ 坏 JSON 不抛错');

// 整段回复
const full = '她看着你。\n\n```cmcc\n+save|event|一起守了半夜的火堆\n```\n';
const pm = parseMemoryCommands(full);
chk(pm.blockCount === 1, '整段：1 个块');
chk(pm.entries.length === 1, '整段：1 条记忆');
chk(pm.entries[0].text === '一起守了半夜的火堆', '整段：内容正确');
chk(parseMemoryCommands('没有块的普通正文').blockCount === 0, '整段：无块');
chk(parseMemoryCommands('').entries.length === 0, '整段：空串安全');

// 多个块
const two = '```cmcc\n+save|e|A\n```\n中间正文\n```cmcc\n+shared|f|B\n```';
chk(parseMemoryCommands(two).blockCount === 2, '整段：认出两个块');
chk(parseMemoryCommands(two).entries.length === 2, '整段：两块合并');

// stripBlocks
const stripped = stripBlocks(full);
chk(!stripped.includes('cmcc'), '★ stripBlocks 去掉记忆块');
chk(stripped.includes('她看着你'), 'stripBlocks 保留正文');
chk(stripBlocks('a\n```js\nvar x=1;\n`\nb').includes('var x=1;'), 'stripBlocks 不动普通代码块');

// commandSpec
const spec = commandSpec();
chk(spec.includes('cmcc'), '格式说明含 cmcc');
chk(spec.includes('一行一条'), '★ 格式说明要求一行一条，不带前缀');
chk(!spec.includes('+save|'), '★ 格式说明不再要求 +scope| 前缀');
chk(spec.includes('最多 5 条'), '格式说明有数量约束');
console.log('');

// ── 15. 空存档不该被自动创建 ──
console.log('【15】按需创建（默认空的）');
const fresh = emptyWorld('测试世界');
chk(Object.keys(fresh.saves).length === 0, '★ 新世界默认没有任何存档');
chk(bookStats({}).worldCount === 0, '★ 空记忆模型 → 0 个世界');
chk(bookStats({}).totalEntries === 0, '★ 空记忆模型 → 0 条记忆');
const afterAdd = emptyWorld('测试世界');
ensureSave(afterAdd, 's1', '存档1');
chk(Object.keys(afterAdd.saves).length === 1, '写入时才创建存档');
chk(worldStats(afterAdd).count === 0, '★ 刚创建的存档是空的（0 条）');


// ── 16. 世界级记忆真的会被注入（回归）──
console.log('【16】世界级记忆注入');
const worldModel = {
    worlds: {
        'char:A.png': {
            label: '全球冰封', lastSeen: 5,
            saves: {
                [WORLDBOOK_CHANNEL]: { label: '整个世界', lastSeen: 5, entries: [
                    { ts: 1, text: '这世界有一种叫黑石的矿，能烧' },
                ] },
                s1: { label: '存档1', lastSeen: 5, entries: [
                    { ts: 2, text: '在避难所里冻了一夜' },
                ] },
                s2: { label: '存档2', lastSeen: 3, entries: [
                    { ts: 3, text: '这次直接进了地堡' },
                ] },
            },
        },
    },
};

// 处在存档1：世界级 + 存档1 + 存档2 都该在
const wm = buildMemoryBlock({
    mem: worldModel, wKey: 'char:A.png', sKey: 's1', wLabel: '全球冰封', budget: 4000,
});
chk(wm.includes('黑石'), '★ 世界级记忆被注入（曾经完全丢失）');
chk(wm.includes('这个世界的常识'), '★ 世界级记忆有独立标题');
chk(wm.includes('这一次发生的事'), '★ 存档记忆有独立标题');
chk(wm.includes('在避难所里冻了一夜'), '存档1 记忆被注入');
chk(wm.includes('地堡'), '存档2 作为「另外一次经历」被注入');
chk(!wm.includes('整个世界（另外一次经历）'), '★ 世界通道没被当成一个存档');
chk(wm.indexOf('黑石') < wm.indexOf('在避难所里冻了一夜'), '世界级排在存档级之前');

// 换到存档2：世界级仍在（这正是 world 范围的意义）
const wm2 = buildMemoryBlock({
    mem: worldModel, wKey: 'char:A.png', sKey: 's2', wLabel: '全球冰封', budget: 4000,
});
chk(wm2.includes('黑石'), '★ 换存档后世界级记忆依然在（world 范围的意义）');
chk(wm2.includes('地堡'), '换存档后当前存档记忆正确');
chk(wm2.includes('避难所'), '旧存档变成「另外一次经历」');

// 只有世界级记忆、没有存档记忆时也不该丢
const onlyWorld = {
    worlds: { w: { label: 'W', lastSeen: 1, saves: {
        [WORLDBOOK_CHANNEL]: { label: '整个世界', lastSeen: 1, entries: [{ ts: 1, text: '只有世界级' }] },
    } } },
};
const ow = buildMemoryBlock({ mem: onlyWorld, wKey: 'w', sKey: 'sX', wLabel: 'W', budget: 2000 });
chk(ow.includes('只有世界级'), '★ 只有世界级记忆时也能注入');
chk(ow.includes('当前位置：W'), '没有存档时标题不显示存档名');

// 世界通道不计入存档数
const wst = worldStats(worldModel.worlds['char:A.png']);
chk(wst.saveCount === 2, '★ 世界通道不计入存档数（应为 2）');
chk(wst.count === 3, '世界级条目仍计入这个世界总数');
chk(wst.worldEntryCount === 1, '单独暴露世界级条目数');
chk(wst.saves.every((x) => x.key !== WORLDBOOK_CHANNEL), '存档列表里没有世界通道');

// bookStats 排除内部容器
const bst = bookStats({
    'char:A.png': worldModel.worlds['char:A.png'],
    __shared__: { label: '共同', saves: { common: { label: '共同', entries: [{ ts: 1, text: 'x' }] } } },
});
chk(bst.worldCount === 1, '★ __shared__ 不算一个世界');
chk(bst.sharedCount === 1, '共同记忆单独计数');
chk(!bst.worlds.some((w) => w.key === '__shared__'), '世界列表里没有 __shared__');
console.log('');


// ── 17. 复刻真实数据：次数 ≠ 条数（截图回归）──
console.log('【17】次数与条数不能混');
// 真实案例：仙子堕落记2.1.1 MVU，4 个存档 + 1 条世界级记忆
const realW = emptyWorld('仙子堕落记2.1.1 MVU');
ensureSave(realW, WORLDBOOK_CHANNEL, '整个世界');
addMemory(realW, WORLDBOOK_CHANNEL, '青芜宗药母白芷对极品活首有着细致照料', 'world');
for (const k of ['存档1', '存档2', '存档5', '存档6']) {
    ensureSave(realW, k, k);
    addMemory(realW, k, '某事', 'memo');
}
const rst = worldStats(realW);
chk(Object.keys(realW.saves).length === 5, '底层有 5 个键（4 存档 + 1 世界通道）');
chk(rst.saveCount === 4, '★ 显示的是「4 次」，不是 5 次（世界通道不算存档）');
chk(rst.count === 5, '总条数 5 条（世界级条目仍计入这个世界）');
chk(rst.worldEntryCount === 1, '世界级 1 条');
chk(rst.saves.length === 4, '存档列表 4 项');
chk(rst.saves.every((x) => x.key !== WORLDBOOK_CHANNEL), '存档列表里没有世界通道');
console.log('');


// ── 18. 批量删除 ──
console.log('【18】批量删除');
function mkWorld(n) {
    const w = emptyWorld('W');
    ensureSave(w, 's1', '存档1');
    for (let i = 0; i < n; i++) addMemory(w, 's1', '第' + i + '条', 'memo');
    return w;
}
function texts(w, k = 's1') { return (w.saves[k]?.entries || []).map((e) => e.text); }

let w1 = mkWorld(6);
let del = deleteMemories(w1, 's1', [1, 3, 5]);
chk(del === 3, '删 3 条');
chk(texts(w1).join(',') === '第0条,第2条,第4条', '★ 删对了（不是按下标位移后删错）');
chk(texts(w1).length === 3, '剩 3 条');

w1 = mkWorld(5);
chk(deleteMemories(w1, 's1', [1, 1, 1]) === 1, '★ 重复下标只删一次');
chk(texts(w1).length === 4, '去重后剩 4 条');

w1 = mkWorld(3);
chk(deleteMemories(w1, 's1', [99, -1, 0]) === 1, '★ 越界下标被忽略');
chk(texts(w1).length === 2, '只删掉合法的那条');

w1 = mkWorld(3);
chk(deleteMemories(w1, 's1', []) === 0, '空数组 → 0');
chk(deleteMemories(w1, 's1', null) === 0, 'null → 0');
chk(deleteMemories(w1, '不存在', [0]) === 0, '不存在的存档 → 0');
chk(deleteMemories(null, 's1', [0]) === 0, 'null world → 0');

w1 = mkWorld(3);
chk(deleteMemories(w1, 's1', [0, 1, 2]) === 3, '全删');
chk(texts(w1).length === 0, '删光了');

// 乱序下标也要正确
w1 = mkWorld(6);
chk(deleteMemories(w1, 's1', [5, 0, 3]) === 3, '乱序下标');
chk(texts(w1).join(',') === '第1条,第2条,第4条', '★ 乱序也删对');
console.log('');

// ── 19. 按范围删除 ──
console.log('【19】按范围删除');
function fullModel() {
    const worlds = {};
    const A = emptyWorld('世界A');
    ensureSave(A, 's1', '存档1'); addMemory(A, 's1', 'A存档1的事', 'memo');
    ensureSave(A, 's2', '存档2'); addMemory(A, 's2', 'A存档2的事', 'memo');
    ensureSave(A, CH, '整个世界'); addMemory(A, CH, 'A世界级', 'world');
    worlds['char:A'] = A;

    const B = emptyWorld('世界B');
    ensureSave(B, 's1', '存档1'); addMemory(B, 's1', 'B的事', 'memo');
    worlds['char:B'] = B;

    const SH = emptyWorld('共同');
    ensureSave(SH, 'common', '共同'); addMemory(SH, 'common', '共同记忆', 'shared');
    worlds.__shared__ = SH;
    return worlds;
}
const pos = { wKey: 'char:A', sKey: 's1', wLabel: '世界A' };

// save 级
let m = fullModel();
let rs = clearByScope(m, 'save', pos);
chk(rs.deleted === 1, '清空本次：删 1 条');
chk(!m['char:A'].saves.s1.entries.length, '★ 存档还在，只是空了');
chk(!!m['char:A'].saves.s1, '★ 存档本身没被删');
chk(m['char:A'].saves[CH].entries.length === 1, 'world 级未受影响');
chk(m['char:B'].saves.s1.entries.length === 1, '别的世界未受影响');
chk(m.__shared__.saves.common.entries.length === 1, '共同记忆未受影响');
chk(rs.what.includes('世界A'), '返回里带了世界名');

// world 级
m = fullModel();
r = clearByScope(m, 'world', pos);
chk(rs.deleted === 1, '清空世界级：删 1 条');
chk(!m['char:A'].saves[CH], '★ 世界级通道已清');
chk(m['char:A'].saves.s1.entries.length === 1, 'save 级未受影响');
chk(m['char:A'].saves.s2.entries.length === 1, '其他存档未受影响');

// shared
m = fullModel();
r = clearByScope(m, 'shared', pos);
chk(rs.deleted === 1, '清空共同：删 1 条');
chk(!m.__shared__.saves.common, '★ 共同记忆已清');
chk(m['char:A'].saves.s1.entries.length === 1, '世界 A 未受影响');

// currentWorld
m = fullModel();
const cw = clearByScope(m, 'currentWorld', pos);
chk(cw.deleted === 3, '删整个世界：3 条（存档1 + 存档2 + 世界级，不含共同）');
chk(!m['char:A'], '★ 世界 A 已整个移除');
chk(!!m['char:B'], '别的世界还在');
chk(!!m.__shared__, '共同记忆还在');

// 边界
m = fullModel();
chk(clearByScope(m, 'save', { wKey: '不存在', sKey: 'x' }).deleted === 0, '不存在的世界 → 0');
chk(clearByScope(m, '未知范围', pos).deleted === 0, '未知范围 → 0');
chk(clearByScope(null, 'save', pos).deleted === 0, 'null worlds → 0');
console.log('');

// ── 20. 清理空壳 ──
console.log('【20】清理空壳');
m = fullModel();
m['char:C'] = emptyWorld('世界C');           // 完全没有存档
ensureSave(m['char:A'], '空存档', '空');
// ⚠ purgeEmpty 会改数据，只能调一次再读结果
const pe = purgeEmpty(m);
chk(pe.worlds >= 1, '★ 清掉了没有任何存档的世界');
chk(!m['char:C'], '世界C 已移除');
chk(pe.saves >= 1, '★ 清掉了空存档（' + pe.saves + ' 个）');
const kept = Object.keys(m['char:A'].saves);
chk(!kept.includes('空存档'), '空存档没了');
chk(kept.includes('s1') && kept.includes('s2') && kept.includes(CH), '有内容的都留着');
console.log('');


// ── 21. <details> 记忆块（新格式，美化用）──
console.log('【21】details 记忆块');
const D = (inner) => '<details class="cmcc"><summary>本次记忆</summary>\n'
    + inner + '\n</details>';

const dtext = '正文写完了。\n\n'
    + D('+save|event|在避难所里冻了一夜\n+shared|rel|她答应不再让你一个人走夜路');
const db = extractBlocks(dtext);
chk(db.length === 1, '★ 从 <details class="cmcc"> 里抽出一个块');
chk(db[0].includes('避难所'), '块内容正确');

const dp = parseMemoryCommands(dtext);
chk(dp.blockCount === 1, '整段：认出 1 个 details 块');
chk(dp.entries.length === 2, '★ details 块里解析出 2 条');
chk(dp.entries[0].scope === 'save', '第一条 scope 对');
chk(dp.entries[1].scope === 'shared', '第二条 scope 对');
chk(dp.entries[0].text === '在避难所里冻了一夜', '★ <summary> 没被当成记忆内容');

// 保留旧格式兼容
const oldFmt = 'x\n```cmcc\n+save|event|旧格式\n```';
chk(parseMemoryCommands(oldFmt).entries.length === 1, '★ 旧的 ```cmcc 仍然认');

// 两种混用
const mixed = D('+save|event|新的') + '\n```cmcc\n+save|event|旧的\n```';
chk(parseMemoryCommands(mixed).entries.length === 2, '★ 新旧格式混用都能抽到');

// stripBlocks 也能去 details
const stD = stripBlocks(dtext);
chk(!stD.includes('cmcc'), '★ stripBlocks 去掉 details 块');
chk(stD.includes('正文写完了'), 'stripBlocks 保留正文');
chk(stripBlocks('<details class="other">x</details>').includes('other'),
    'stripBlocks 不动别的 details');

// HTML 包装容错
chk(parseBlock('<p>+save|event|带p标签</p>').entries.length === 1,
    '★ 行里带 HTML 标签也能解析');
chk(parseBlock('<p>+save|event|带p标签</p>').entries[0].text === '带p标签',
    '标签被清掉');

// commandSpec 用新格式
const sp = commandSpec();
chk(sp.includes('`cmcc'), '★ 格式说明用专属围栏 `cmcc');
chk(sp.includes('必须是你和 {user} 两个人共同经历'), '★★ 强制要求「两人共同经历」');
chk(sp.includes('你不在场时发生的事'), '★ 明确排除她不在场的事');
chk(sp.includes('30~50 字'), '★★ 强制要求 30~50 字');
chk(sp.includes('尽量写详细'), '★ 要求写详细，不是一句话概括');
chk(sp.includes('不要编号'), '要求不要编号/前缀');
chk(!sp.includes('<details'), '★ 不再用 details 格式（改回围栏）');
chk(sp.includes('就不输出这个块'), '★ 没有共同经历时明确不要输出');
chk(sp.includes('共同记忆'), '格式说明含 summary 标题');
chk(sp.includes('不要写范围'), '★ 格式说明明确不用写范围');
console.log('');


// ── 22. 静态检查：index.js 里的裸函数调用必须有定义 ──
// 真实事故：index.js 调了裸的 refreshTop()，但它其实是 api 的方法
//   → ReferenceError，把整个启动补挂块炸掉，表现为「设置面板点不开」。
//   语法检查抓不到，单元测试跑不到，只有启动时炸，极难定位。
//
// 只查 index.js、只查"动词式命名"的裸调用，配一份明确的外部名字白名单。
// 刻意保守：宁可漏报，也不要一堆误报（一直红的检查等于没有）。
console.log('【22】静态检查：index.js 裸函数调用');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dir22 = dirname(fileURLToPath(import.meta.url));

const code22 = readFileSync(join(__dir22, '..', 'index.js'), 'utf8');

// 本文件里定义的名字
const defs22 = new Set();
for (const re of [
    /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
]) {
    let m;
    while ((m = re.exec(code22)) !== null) defs22.add(m[1]);
}
// import { … }
{
    const imp = /import\s*\{([^}]*)\}\s*from/g;
    let m;
    while ((m = imp.exec(code22)) !== null) {
        m[1].split(',').forEach((x) => {
            const n = x.trim().split(/\s+as\s+/).pop().trim();
            if (n) defs22.add(n);
        });
    }
}
// 允许的外部名字（JS 内置 + ST 全局 + 我们已知的外部 API）
const OK22 = new Set([
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'getComputedStyle', 'structuredClone', 'queueMicrotask', 'fetch', 'alert', 'confirm',
    'getContext', 'loadWorldInfo', 'saveWorldInfo', 'updateWorldInfoList',
    'createNewWorldInfo', 'getWorldInfoPrompt', 'generateQuietPrompt', 'generateRaw',
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new',
    'delete', 'void', 'instanceof', 'await', 'async', 'super', 'constructor',
]);

// 只认「动词式」命名（正是 refreshTop 那类，也是模块内函数互相调用的常见形态）
const VERBY = /^(?:refresh|render|update|sync|load|save|write|read|build|make|apply|init|handle|notify|purge|migrate|emit|toggle)[A-Z_$\w$]*$/;
const bad22 = new Set();
{
    const re = /(?<![.\w$'"`])([a-zA-Z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(code22)) !== null) {
        const n = m[1];
        if (defs22.has(n) || OK22.has(n)) continue;
        if (!VERBY.test(n)) continue;
        // 方法定义形态 `name() {` 跳过
        const after = code22.slice(m.index, m.index + 60);
        if (/^[A-Za-z_$][\w$]*\s*\(\s*\)\s*\{/.test(after) && after.includes('{')) continue;
        bad22.add(n);
    }
}
chk(bad22.size === 0,
    '★ index.js 里动词式裸调用都有定义' + (bad22.size ? ` → 可疑: ${[...bad22].join(', ')}` : ''));
console.log('');

// ── 23. 读预设自带的 <summary> 摘要 ──
console.log('【23】预设摘要 → 记忆');
// 预设原文（Kemini_Dramatron_v3.2 prompts[50]）：
//   摘要格式示例： <summary> 用约150字概括本条回复的具体事件… </summary>
const SUM_TEXT = '朱九自虚空出手以虚空大擒拿瞬间禁锢正在采撷赤阳金莲的天仙书院奇才凤舞，'
    + '并连同圣药一并收入万象乾坤小世界。在飞仙池畔，朱九向凤舞阐明群芳天阙开阁与挂牌论道之意，'
    + '随后将其带出小世界返回天仙圣城后山水榭。展若彤与魔女现身与凤舞相认，'
    + '凤舞放下戒备并解下长弓正式入驻仙坊。';

// ① 原始形态（AI 刚输出，还没被预设正则处理）
const rawMsg = '正文正文正文。\n\n<summary>\n' + SUM_TEXT + '\n</summary>';
chk(extractPresetSummary(rawMsg) === SUM_TEXT, '★ 读到裸 <summary>（原始形态）');

// ② 已渲染形态（预设正则把它变成了折叠卡片）
const renderedMsg = '正文正文。\n\n<details><summary>摘要</summary>\n'
    + SUM_TEXT + '\n</details>';
chk(extractPresetSummary(renderedMsg) === SUM_TEXT, '★ 读到已折叠的 <details><summary>摘要</summary>');

// ③ 我们自己的 cmcc 折叠块不能被误读成摘要
const ourBlock = '<details class="cmcc"><summary>本次记忆</summary>\n'
    + '沈清梦在琉璃盒内主动索求\n</details>';
chk(extractPresetSummary(ourBlock) === '', '★ 不误读我们自己的 cmcc 块');

// ④ 没有摘要就返回空
chk(extractPresetSummary('就是一段普通正文') === '', '无摘要 → 空串');
chk(extractPresetSummary('') === '', '空串安全');
chk(extractPresetSummary(null) === '', 'null 安全');

// ⑤ 多种标题写法
chk(extractPresetSummary('<details><summary>总结</summary>X</details>') === 'X', '认「总结」标题');
chk(extractPresetSummary('<details><summary>summary</summary>Y</details>') === 'Y', '认英文 summary');

// ⑥ 带 HTML 的摘要要清理
chk(extractPresetSummary('<summary>A<br>B<b>C</b></summary>') === 'A\nBC', '★ 清掉 HTML 标签、<br> 转换行');

// ── 切句 ──
console.log('');
console.log('【23b】摘要切句');
const sents = splitSummary(SUM_TEXT);
chk(sents.length >= 2, `★ 150 字摘要切成多条（实际 ${sents.length} 条）`);
chk(sents.every((x) => x.length <= 120), '每条不超过 120 字');
chk(sents.join('').replace(/\s/g, '') === SUM_TEXT.replace(/\s/g, ''), '★ 切句不丢字');
chk(splitSummary('') .length === 0, '空 → 空数组');
chk(splitSummary(null).length === 0, 'null → 空数组');
chk(splitSummary('只有一句话。').length === 1, '单句 → 1 条');
chk(splitSummary('a。b。c。d。e。f。g。h。i。j。k。l。m。n。', { max: 5 }).length <= 5, '★ max 上限生效');
// 长句按逗号再切
const longOne = '第一段很长的内容，' + '继续描述细节，'.repeat(8) + '结束。';
chk(splitSummary(longOne).every((x) => x.length <= 120), '★ 超长句会再切');

// ── summaryHint ──
const hint = summaryHint();
chk(!hint.includes('会被当作'), '★ 不再说摘要会被当记忆');
chk(hint.includes('共同记忆'), '提示词指向共同记忆块');
chk(hint.includes('不是你的记忆'), '★ 提示词明确摘要不进记忆');
console.log('');

// ── 24. 接入：没有 cmcc 块时用摘要 ──
console.log('【24】摘要接入记忆流程');
const msgWithSummary = '正文。\n<summary>' + SUM_TEXT + '</summary>';
const cm = parseMemoryCommands(msgWithSummary);
chk(cm.blockCount === 0, '这条消息没有 cmcc 块');
const fromSum = splitSummary(extractPresetSummary(msgWithSummary));
chk(fromSum.length >= 2, '（summary.js 仍有切句能力，但已不接入）');
chk(fromSum.every((x) => typeof x === 'string' && x.length), '切出来的都是非空字符串');
// 两者都有时，cmcc 块优先
const both = msgWithSummary + '\n<details class="cmcc"><summary>本次记忆</summary>\n显式记忆\n</details>';
chk(parseMemoryCommands(both).entries.length === 1, '★ 两者都有时，cmcc 块优先被解析');
console.log('');

console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail ? 1 : 0);
