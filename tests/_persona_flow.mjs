/**
 * 人设预设：删除 / 导出 / 导入 的端到端复现
 *
 * 用户报的问题：
 *   "导入之后无法正常显示；删除人设预设也没办法删除
 *    （只留下名字，预设没删除，但其他内容没了，成功删除了一个，另外两个删除不了）"
 *
 * 这里用一个**贴近真实的 settings 对象**把整条链路跑一遍，
 * 看看到底哪一步把数据弄坏了。
 *
 * 用法: node tests/_persona_flow.mjs
 */
import { normalizeSettings, activePersonaOf, nextPersonaId } from '../src/state.js';
import { mergePersona, buildExport, mergeWorlds } from '../src/portable.js';

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };
const brief = (s) => (s.builtins || []).map((x) =>
    `${x.name}[${x.id}]${x.id === s.activeBuiltinId ? '*' : ''}`
    + `(d${(x.description || '').length},p${(x.personality || '').length},s${(x.scenario || '').length})`).join('  ');

// ══════════════════════════════════════════════
console.log('【0】模拟插件启动：normalizeSettings 只跑一次');
// ══════════════════════════════════════════════
// 用户在磁盘上的状态：同伴(空) + 两条一样的拉普兰德
const disk = {
    builtins: [
        { id: 'p1', name: '同伴', description: '', personality: '', scenario: '' },
        { id: 'p2', name: '拉普兰德', description: 'D', personality: 'P', scenario: 'S' },
        { id: 'p3', name: '拉普兰德', description: 'D', personality: 'P', scenario: 'S' },
    ],
    activeBuiltinId: 'p3',
};
let settings = normalizeSettings(disk);
console.log('  启动后:', brief(settings));
chk(settings.builtins.length === 2, `★ 去重后 2 个人设（实际 ${settings.builtins.length}）`);
chk(settings.activeBuiltinId === 'p2', '★ 激活项从被删的 p3 转到保留的 p2');

// ══════════════════════════════════════════════
console.log('');
console.log('【1】删除人设（模拟 api.deletePersona）');
// ══════════════════════════════════════════════
function deletePersona(settings, id) {
    // ↓ 与 index.js 里的实现逐行一致
    const list = settings.builtins || [];
    if (list.length <= 1) return { ok: false, why: '至少要保留一个' };
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false, why: '找不到 id=' + id };
    list.splice(idx, 1);
    if (settings.activeBuiltinId === id) settings.activeBuiltinId = list[0].id;
    settings.builtin = Object.assign({}, activePersonaOf(settings));
    return { ok: true };
}

const before = brief(settings);
const r1 = deletePersona(settings, 'p2');
console.log('  删 p2 →', r1.ok ? 'ok' : ('失败: ' + r1.why));
console.log('  删除前:', before);
console.log('  删除后:', brief(settings));
chk(r1.ok, '★ 删除成功');
chk(settings.builtins.length === 1, `★ 列表剩 1 个（实际 ${settings.builtins.length}）`);
chk(settings.builtins[0].name === '同伴', '★ 剩下的是「同伴」');
chk(settings.builtins.every((x) => x.id !== 'p2'), '★ 被删的确实不在了');
chk(settings.activeBuiltinId === 'p1', '★ 激活项切到剩下的那个');

// ══════════════════════════════════════════════
console.log('');
console.log('【2】只剩 1 个时删除 —— 应被拒绝');
// ══════════════════════════════════════════════
{
    const r = deletePersona(settings, settings.activeBuiltinId);
    chk(!r.ok, `★ 被拒绝（${r.why}）`);
    chk(settings.builtins.length === 1, '列表没变');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【3】★ 关键：删除后再 normalizeSettings 一次，看会不会"复活"');
// ══════════════════════════════════════════════
{
    // 场景 A：settings 是同一个对象（index.js 的做法）
    const again = normalizeSettings(settings);
    console.log('  再规范化:', brief(again));
    chk(again.builtins.length === 1, `★ 没有复活（实际 ${again.builtins.length}）`);

    // 场景 B：老字段 builtin 里还留着被删的人设内容
    //   ← 这正是可疑点：settings.builtin 是"激活项镜像"，
    //     如果它没跟着更新，normalizeSettings 会不会把它当成老数据重新塞回列表？
    const dirty = {
        builtins: [{ id: 'p1', name: '同伴', description: '', personality: '', scenario: '' }],
        activeBuiltinId: 'p1',
        // 故意留一份"被删掉的拉普兰德"在老字段里
        builtin: { name: '拉普兰德', description: 'D', personality: 'P', scenario: 'S' },
    };
    const res = normalizeSettings(dirty);
    console.log('  builtin 残留旧内容时:', brief(res));
    chk(res.builtins.length === 1,
        `★★ 老字段 builtin 里的旧人设【不该】被复活（实际 ${res.builtins.length} 条）`);
    chk(res.builtins[0].name === '同伴', '★ 列表仍是「同伴」，没被 builtin 覆盖');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【4】导入到只有 1 个空人设的环境（用户的真实场景）');
// ══════════════════════════════════════════════
{
    const s = normalizeSettings({});
    console.log('  导入前:', brief(s));
    const lappland = {
        name: '拉普兰德', description: 'D', personality: 'P', scenario: 'S',
    };
    const nm = mergePersona(s, lappland, true, nextPersonaId);
    console.log('  导入后:', brief(s));
    chk(nm === '拉普兰德', '返回名字');
    chk(s.builtins.length === 2, `★ 2 个人设（实际 ${s.builtins.length}）`);
    chk(activePersonaOf(s).name === '拉普兰德', '★ 激活的是新导入的');
    chk(activePersonaOf(s).description === 'D', '★ 描述在');

    // 再来一次规范化
    const s2 = normalizeSettings(s);
    chk(s2.builtins.length === 2, `★ 规范化后仍是 2 个（实际 ${s2.builtins.length}）`);
    chk(activePersonaOf(s2).description === 'D', '★ 规范化后描述还在');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【5】导入两份不同内容但同名的 —— 不该被去重掉');
// ══════════════════════════════════════════════
{
    const s = normalizeSettings({});
    mergePersona(s, { name: '小满', description: 'A', personality: '', scenario: '' }, true, nextPersonaId);
    mergePersona(s, { name: '小满', description: 'B', personality: '', scenario: '' }, true, nextPersonaId);
    console.log('  ', brief(s));
    chk(s.builtins.length === 3, `★ 3 个（内容不同，不算重复）实际 ${s.builtins.length}`);
    const s2 = normalizeSettings(s);
    chk(s2.builtins.length === 3, '★ 规范化后仍是 3 个');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【6】★ 真实 bug 复现：删完最后一个再导入，再删');
// ══════════════════════════════════════════════
{
    let s = normalizeSettings({});
    const nm = mergePersona(s, { name: '拉普兰德', description: 'D', personality: 'P', scenario: 'S' },
        true, nextPersonaId);
    const newId = s.activeBuiltinId;
    console.log('  导入后:', brief(s));

    // 删掉「同伴」
    const r = deletePersona(s, 'p1') || deletePersona(s, s.builtins.find((x) => x.name === '同伴')?.id);
    console.log('  删同伴 →', r.ok ? 'ok' : r.why);
    console.log('  删除后:', brief(s));
    chk(s.builtins.length === 1 && s.builtins[0].name === '拉普兰德',
        `★ 只剩拉普兰德（实际 ${brief(s)}）`);

    // 再规范化
    const s2 = normalizeSettings(s);
    console.log('  规范化后:', brief(s2));
    chk(s2.builtins.length === 1, '★ 仍是 1 个');
    chk(s2.builtins[0].name === '拉普兰德', '★ 名字对');
    chk(s2.builtins[0].description === 'D', '★★ 描述还在（用户说"只留下名字、其他内容没了"）');
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
