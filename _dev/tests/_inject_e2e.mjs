/**
 * 端到端注入验证（最重要的测试）
 *
 * 回答用户真正担心的问题：
 *   「AI 到底能不能读取到插件里面内置的记忆和人设？」
 *
 * 做法：用真实的 buildGuide / buildMemoryBlock / injectIntoRequest，
 * 配一份真实形状的数据，走完整条链，然后**逐项检查生成的提示词里有没有该有的东西**。
 *
 * 用法: node tests/_inject_e2e.mjs
 */
import {
    buildGuide, buildMemoryBlock, buildInjectionText,
    injectIntoRequest, stripFromMessages, estimateTokens, TAG,
} from '../src/inject.js';
import { commandSpec, parseMemoryCommands } from '../src/memo.js';

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };
const has = (hay, needle) => String(hay).includes(needle);

// ══════════════════════════════════════════════
// ① 模拟插件里存的内置人设
// ══════════════════════════════════════════════
const companion = {
    name: '小满',
    isBuiltin: true,
    data: {
        name: '小满',
        description: '一个总是跟着 {user} 的少女。灰发，旧披风，左手腕有一道旧疤。',
        personality: '话少，但记得每一件小事。不喜欢被道谢。',
        scenario: '她不是任何世界的人，只是 {user} 的同伴。',
    },
};

// ══════════════════════════════════════════════
// ② 模拟记忆（当前存档 + 另一个存档 + 共同）
// ══════════════════════════════════════════════
const mem = {
    worlds: {
        'char:A.png': {
            label: '全球冰封 v3.1.3', lastSeen: 9,
            saves: {
                'chat-now': { label: '存档1', lastSeen: 9, entries: [
                    { ts: 10, text: '在避难所里和她一起冻了一夜' },
                    { ts: 11, text: '找到一箱罐头，她让 {user} 先吃' },
                    { ts: 12, text: '她把手套给了 {user}，自己揣着手' },
                ] },
                'chat-old': { label: '存档2', lastSeen: 3, entries: [
                    { ts: 5, text: '坐在车里赶了很久的雪路' },
                ] },
            },
        },
    },
};

const settings = {
    tokenBudget: 1200, memoryBudget: 1800, announceSaveSwitch: true,
    readMemoryCommands: true, recentMemoryLimit: 8, relevantMemoryLimit: 4,
};

// ══════════════════════════════════════════════
// ③ 走真实链路
// ══════════════════════════════════════════════
console.log('════ 端到端注入验证 ════');
console.log('');
console.log('【1】生成引导（人设 + 位置 + 底线）');
const guide = buildGuide({
    companion,
    wLabel: '全球冰封 v3.1.3',
    saveLabel: '存档1',
    saveCount: 2,
    otherSaveLabels: ['存档2'],
    settings,
    saveSwitched: false,
    memoSpec: commandSpec(),
});
chk(!!guide, '引导非空');
chk(has(guide, TAG), '带 cmcc_guide 标记');
chk(has(guide, '小满'), '★ 人设的**名字**进去了');
chk(has(guide, '灰发'), '★ 人设的 **description** 进去了');
chk(has(guide, '话少'), '★ 人设的 **personality** 进去了');
chk(has(guide, '只是 {user} 的同伴'), '★ 人设的 **scenario** 进去了');
chk(has(guide, '一个独立的人'), '★ 声明她是独立的人');
chk(has(guide, '从开场白起你就在场'), '★ 要求开场白即在场的同行者');
chk(has(guide, '全球冰封 v3.1.3'), '★ 当前世界进去了');
chk(has(guide, '不要提'), '★ 硬性底线进去了');
chk(has(guide, '尤其不能对别的角色'), '★ 「不能对 NPC 出戏」约束进去了');
chk(has(guide, '```cmcc'), '★ 记忆块格式说明进去了');
console.log('');

console.log('【2】生成记忆块（最近 + 相似旧事）');
const memory = buildMemoryBlock({
    mem, wKey: 'char:A.png', sKey: 'chat-now', wLabel: '全球冰封 v3.1.3',
    budget: 1800,
    recentLimit: settings.recentMemoryLimit,
    relevantLimit: settings.relevantMemoryLimit,
    context: '我们坐在车里，窗外是雪',   // ← 正在写"车里"，应该想起存档2 的车里
});
chk(!!memory, '记忆块非空');
chk(has(memory, '最近和你一起经历的'), '★ 有「最近」分节');
chk(has(memory, '在避难所里和她一起冻了一夜'), '★ 当前存档的记忆进去了');
chk(has(memory, '找到一箱罐头'), '★ 第二条记忆也进去了');
chk(has(memory, '她把手套给了'), '★ 第三条记忆也进去了');
chk(has(memory, '和眼前这一幕相似的旧事'), '★ 有「相似旧事」分节');
chk(has(memory, '坐在车里赶了很久的雪路'), '★★ 车里 → 想起了存档2 的车里');
console.log('');

console.log('【3】合成 + 塞进请求体');
const text = buildInjectionText({ guide, memory });
chk(has(text, TAG), '合成文本含引导');
chk(has(text, '灰发'), '合成文本含人设');
chk(has(text, '避难所'), '合成文本含记忆');
chk(text.indexOf(TAG) < text.indexOf('避难所'), '★ 人设在前、记忆在后（优先级）');

// 模拟一次真实的 Chat Completion 请求
const generateData = {
    messages: [
        { role: 'system', content: '你是一个角色扮演助手。' },
        { role: 'user', content: '前情提要：外面在下雪。' },
        { role: 'assistant', content: '（之前的回复）' },
        { role: 'user', content: '我们坐进车里，继续赶路。' },
    ],
};
const before = generateData.messages.length;
const ok = injectIntoRequest(generateData, text);
chk(ok === true, '★ 注入成功');
chk(generateData.messages.length === before + 1, '消息数 +1');
const injected = generateData.messages.find((m) => has(m.content, TAG));
chk(!!injected, '★ 请求体里能找到注入的内容');
chk(injected.role === 'system', '注入的是 system 消息');
chk(has(injected.content, '灰发'), '★ 请求体里有内置人设');
chk(has(injected.content, '避难所'), '★ 请求体里有记忆');
// 插在最后一条 user 之前
const lastUserIdx = generateData.messages.map((m) => m.role).lastIndexOf('user');
const injIdx = generateData.messages.indexOf(injected);
chk(injIdx < lastUserIdx, '★ 注入在最后一条 user 之前（模型能读到）');
chk(injectIntoRequest(generateData, text) === false, '★ 幂等：重复注入被拒');
chk(stripFromMessages(generateData) === 1, '可以清掉');
console.log('');

console.log('【4】AI 输出 → 记忆回流（闭环）');
const aiOutput = [
    '她把手套摘下来递给你。',
    '',
    '```cmcc',
    '和她一起在雪地里走了很久，她一直走在迎风那一侧',
    '她把手套让给 {user}，自己揣着手说不冷',
    '```',
].join('\n');
const parsed = parseMemoryCommands(aiOutput);
chk(parsed.blockCount === 1, '★ 认出 AI 输出的记忆块');
chk(parsed.entries.length === 2, '★ 解析出 2 条记忆');
chk(!has(parsed.entries[0].text, '```'), '记忆内容不含围栏残留');
chk(!has(parsed.entries[0].text, 'cmcc'), '记忆内容不含语言标记');
console.log('');

console.log('【5】规模检查（会不会太大）');
console.log('  人设+底线  : %d 字符 / 约 %d token', guide.length, estimateTokens(guide));
console.log('  记忆块     : %d 字符 / 约 %d token', memory.length, estimateTokens(memory));
console.log('  合计       : %d 字符 / 约 %d token', text.length, estimateTokens(text));
chk(estimateTokens(text) < 2000, '总量在合理范围（< 2000 token）');
chk(estimateTokens(memory) <= 1800 * 1.2, '记忆块没超预算太多');
console.log('');

console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
if (fail) {
    console.log('');
    console.log('=== 实际生成的提示词（供排查）===');
    console.log(text.slice(0, 3000));
}
process.exit(fail === 0 ? 0 : 1);
