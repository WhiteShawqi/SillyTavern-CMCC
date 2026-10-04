/**
 * 实测：完整人设 + 20 条记忆，到底占多少 token？
 * 用途：用真实数字决定 memoryBudget / tokenBudget 的默认值与上限。
 */
import {
    buildGuide, buildMemoryBlock, buildInjectionText, estimateTokens,
} from '../src/inject.js';
import { commandSpec } from '../src/memo.js';

// ── 一个"正常完整的"人设（用户量级：几百字描述 + 性格 + 关系）──
const desc = '她叫小满，看着十六七岁。灰白色长发总是松松地束在脑后，'
    + '有几缕怎么都压不下去。左眼下方有一颗小痣。常年穿一件洗到发白的深色披风，'
    + '里面是方便行动的短打。左手腕有一道很旧的疤，她从不主动提起，'
    + '被问起就说不记得了。她的眼睛是浅琥珀色，认真看你的时候像在数什么。'
    + '她走路很轻，几乎没有声音，常常是 {user} 回头才发现她已经站在旁边。'
    + '她随身带着一个小布包，里面装着一些看不出用途的东西：半块石头、'
    + '一截断掉的弓弦、几颗颜色不一样的纽扣。别人问她就说是捡的。'
    + '她不怕冷，却总把手揣在袖子里。饿了不会说，会盯着 {user} 的碗看。';
const pers = '话很少，但不是冷淡 —— 是习惯把话留到有用的时候。'
    + '记得住每一件小事，尤其是别人的偏好和随口说过的话，'
    + '过很久之后还会照着做。不喜欢被道谢，被谢的时候会移开视线。'
    + '遇到危险先判断退路，不逞强，但真要护着谁的时候一步都不退。'
    + '对陌生人有礼貌但保持距离；熟悉之后话会多一点，偶尔会开很冷的玩笑。'
    + '饿的时候脾气会变差，自己不知道。';
const scen = '她不是任何一个世界原本的人。她只是跟着 {user}，'
    + '从一个地方到另一个地方。她不解释这件事，也不觉得需要解释。'
    + '被问起来历就说得含糊，像是自己也记不清。';

const companion = {
    name: '小满',
    data: { name: '小满', description: desc, personality: pers, scenario: scen },
};

// ── 20 条记忆：10 条「最近」+ 10 条「相似旧事」，每条约 50 字 ──
const M50 = (i) => `第${i}件事：那天在避难所里，她把唯一的手套塞给 {user}，`
    + `自己揣着手说一点都不冷，后来手背冻裂了也没提。`;

const recent = Array.from({ length: 10 }, (_, i) => ({ ts: 100 + i, text: M50(i + 1) }));
const old10 = Array.from({ length: 10 }, (_, i) => ({
    ts: 10 + i, text: `旧事${i + 1}：有一次也是这样坐在车里赶夜路，她把窗摇下来一点，说透透气。`,
}));

const mem = {
    worlds: {
        'char:A.png': {
            label: '某个挺长的世界名 v3.1.3 MVU', lastSeen: 99,
            saves: {
                'chat-now': { label: '存档1', lastSeen: 99, entries: recent },
                'chat-old': { label: '存档2', lastSeen: 20, entries: old10 },
            },
        },
    },
};

const settings = { tokenBudget: 2400, memoryBudget: 1800, announceSaveSwitch: true };

console.log('════ token 预算实测 ════');
console.log('');

// 人设大小
const idOnly = buildGuide({
    companion, wLabel: 'W', saveLabel: 's', saveCount: 1, otherSaveLabels: [],
    settings, saveSwitched: false, memoSpec: '',
});
console.log('【人设 + 位置 + 底线（不含记忆块说明）】');
console.log('  字符 %d  →  %d token', idOnly.length, estimateTokens(idOnly));
console.log('');

// 各段拆开量
const withSpec = buildGuide({
    companion, wLabel: 'W', saveLabel: 's', saveCount: 1, otherSaveLabels: [],
    settings, saveSwitched: false, memoSpec: commandSpec(),
});
console.log('【再加记忆块格式说明】');
console.log('  字符 %d  →  %d token', withSpec.length, estimateTokens(withSpec));
console.log('  （格式说明本身约 %d token）',
    estimateTokens(withSpec) - estimateTokens(idOnly));
console.log('');

// 记忆块：20 条
const memFull = buildMemoryBlock({
    mem, wKey: 'char:A.png', sKey: 'chat-now', wLabel: '某个挺长的世界名 v3.1.3 MVU',
    budget: 99999, recentLimit: 10, relevantLimit: 10,
    context: '我们坐在车里，窗外是雪，她把窗摇下来一点',
});
const nLines = (memFull.match(/^- /gm) || []).length;
console.log('【记忆块：10 最近 + 10 相关】');
console.log('  条数 %d  字符 %d  →  %d token', nLines, memFull.length, estimateTokens(memFull));
console.log('  平均每条 %d 字符 → %d token',
    Math.round(memFull.replace(/^#.*$/gm, '').length / Math.max(1, nLines)),
    Math.round(estimateTokens(memFull) / Math.max(1, nLines)));
console.log('');

// 合计
const total = buildInjectionText({ guide: withSpec, memory: memFull });
console.log('【合计（实际会发给 AI 的注入量）】');
console.log('  字符 %d  →  %d token', total.length, estimateTokens(total));
console.log('');

// 默认预算下会被砍成多少
for (const b of [600, 900, 1200, 1800, 2400, 3200, 4000]) {
    const m = buildMemoryBlock({
        mem, wKey: 'char:A.png', sKey: 'chat-now', wLabel: 'W',
        budget: b, recentLimit: 10, relevantLimit: 10,
        context: '我们坐在车里，窗外是雪，她把窗摇下来一点',
    });
    const lines = (m.match(/^- /gm) || []).length;
    console.log('  memoryBudget=' + String(b).padEnd(6) + ' → 注入 ' + String(lines).padStart(2) + ' 条 / ' + String(estimateTokens(m)).padStart(4) + ' token');
}
console.log('');
console.log('【建议】');
const guideTok = estimateTokens(withSpec);
console.log('  引导（人设+底线+格式说明）固定约 %d token', guideTok);
console.log('  20 条记忆约 %d token', estimateTokens(memFull));
console.log('  → tokenBudget 应 >= %d（引导）+ %d（记忆） = %d',
    guideTok, estimateTokens(memFull), guideTok + estimateTokens(memFull));
console.log('  → memoryBudget 默认建议 %d（能装下 20 条）',
    Math.ceil(estimateTokens(memFull) / 100) * 100 + 200);
