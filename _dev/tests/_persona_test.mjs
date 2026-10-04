/**
 * 多内置人设 + 导出/导入 逻辑测试
 * 用法: node tests/_persona_test.mjs
 *
 * 这里测的是「数据结构层」的行为（state.js 的规范化和迁移）。
 * index.js 里的 api.addPersona/exportAll 依赖 ST 运行时，不在此处覆盖。
 */
import {
    normalizeSettings, activePersonaOf, nextPersonaId, DEFAULT_SETTINGS,
} from '../src/state.js';

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('【1】旧数据迁移（老版本只有 settings.builtin 一个对象）');
{
    const s = normalizeSettings({
        builtin: { name: '小满', description: '灰发', personality: '话少', scenario: '同伴' },
    });
    chk(Array.isArray(s.builtins), '★ 自动建出 builtins 列表');
    chk(s.builtins.length === 1, '列表 1 项');
    chk(s.builtins[0].name === '小满', '★ 名字迁进来了');
    chk(s.builtins[0].description === '灰发', '描述迁进来了');
    chk(s.builtins[0].personality === '话少', '性格迁进来了');
    chk(s.builtins[0].scenario === '同伴', '关系迁进来了');
    chk(!!s.activeBuiltinId, '★ 自动指定了激活项');
    chk(s.activeBuiltinId === s.builtins[0].id, '激活项 = 唯一那项');
    chk(s.builtin.name === '小满', '★ 旧字段 builtin 仍指向激活项（兼容老代码）');
}

console.log('');
console.log('【2】全新安装');
{
    const s = normalizeSettings({});
    chk(s.builtins.length === 1, '★ 至少有一个空人设（界面上不至于空白）');
    chk(s.builtins[0].name === '同伴', '默认名字 = 同伴');
    chk(!!s.activeBuiltinId, '有激活项');
}

console.log('');
console.log('【3】多个预设共存（用户的核心诉求）');
{
    const s = normalizeSettings({
        builtins: [
            { id: 'a', name: '小满', description: '灰发' },
            { id: 'b', name: '阿米娅', description: '兔耳' },
            { id: 'c', name: '白芷', description: '医师' },
        ],
        activeBuiltinId: 'b',
    });
    chk(s.builtins.length === 3, '★ 三个预设都在');
    chk(activePersonaOf(s).name === '阿米娅', '★ 激活的是指定的那个');
    chk(s.builtin.name === '阿米娅', '★ builtin 同步到激活项');
    // 切换
    s.activeBuiltinId = 'c';
    chk(activePersonaOf(s).name === '白芷', '★ 能切到第三个');
    chk(activePersonaOf(s).description === '医师', '切换后描述也跟着换');
}

console.log('');
console.log('【4】激活 id 失效的容错');
{
    const s = normalizeSettings({ builtins: [{ id: 'a', name: 'A' }], activeBuiltinId: '不存在的' });
    chk(!!s.activeBuiltinId, '★ 自动纠正为有效 id');
    chk(activePersonaOf(s).name === 'A', '回落到第一项');
    const s2 = normalizeSettings({ builtins: [], activeBuiltinId: 'x' });
    chk(s2.builtins.length === 1, '★ 空列表也会补一个');
}

console.log('');
console.log('【5】脏数据清洗');
{
    const s = normalizeSettings({
        builtins: [
            null,
            'not an object',
            { id: 'ok', name: '正常' },
            { id: 'n', name: 123, description: null },
        ],
    });
    chk(s.builtins.length === 2, `★ 过滤掉非对象项（剩 2 项，实际 ${s.builtins.length}）`);
    chk(s.builtins.every((x) => typeof x.description === 'string'), '★ 字段都规范成字符串');
    chk(s.builtins.every((x) => typeof x.name === 'string'), '★ 名字都是字符串');
    chk(s.builtins.every((x) => !!x.id), '★ 缺 id 的自动补上');
}

console.log('');
console.log('【6】id 唯一性');
{
    const ids = new Set();
    for (let i = 0; i < 200; i++) ids.add(nextPersonaId());
    chk(ids.size === 200, '★ 连生成 200 个 id 无重复');
    const s = normalizeSettings({ builtins: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    const sids = s.builtins.map((x) => x.id);
    chk(new Set(sids).size === 3, '★ 无 id 的多项各自补到不同的 id');
}

console.log('');
console.log('【7】normalizeSettings 幂等（反复规范化不改变结果）');
{
    const once = normalizeSettings({
        builtin: { name: '小满', description: 'D', personality: 'P', scenario: 'S' },
    });
    const twice = normalizeSettings(once);
    chk(twice.builtins.length === once.builtins.length, '★ 列表长度不变（不会重复迁移）');
    chk(twice.activeBuiltinId === once.activeBuiltinId, '★ 激活项不变');
    chk(twice.builtin.name === '小满', '内容不变');
    const thrice = normalizeSettings(twice);
    chk(thrice.builtins.length === 1, '★ 第三次仍然 1 项');
}

console.log('');
console.log('【8】DEFAULT_SETTINGS 完整性');
{
    chk(Array.isArray(DEFAULT_SETTINGS.builtins), 'builtins 是数组');
    chk(typeof DEFAULT_SETTINGS.activeBuiltinId === 'string', 'activeBuiltinId 是字符串');
    chk(DEFAULT_SETTINGS.tokenBudget >= 1073,
        `★ tokenBudget 默认值 >= 实测引导成本 1073（实际 ${DEFAULT_SETTINGS.tokenBudget}）`);
    chk(DEFAULT_SETTINGS.recentMemoryLimit >= 5 && DEFAULT_SETTINGS.recentMemoryLimit <= 10,
        `★ 最近记忆默认在 5~10（实际 ${DEFAULT_SETTINGS.recentMemoryLimit}）`);
    chk(DEFAULT_SETTINGS.relevantMemoryLimit >= 2 && DEFAULT_SETTINGS.relevantMemoryLimit <= 5,
        `★ 相似旧事默认在 2~5（实际 ${DEFAULT_SETTINGS.relevantMemoryLimit}）`);
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
