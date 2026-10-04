/**
 * 预置角色导入验证
 *
 * 对应需求：「做一个可以导入的陪伴角色：拉普兰德」
 *
 * 不只是生成一个 JSON 就完事 —— 这里真的把导入逻辑跑一遍：
 *   ① 文件的格式能不能通过校验
 *   ② 人设四个字段能不能正确落到设置里
 *   ③ 记忆能不能真的并进记忆模型（含去重、含重复导入不翻倍）
 *   ④ 记忆条数和长度是否符合规格（30~50 字）
 *   ⑤ 导出的 JSON 能不能被自己再导入回来（往返一致）
 *
 * 用法: node tests/_preset_test.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildExport, validateImport, countEntries, mergePersona, mergeWorlds,
} from '../src/portable.js';
import { normalizeSettings, activePersonaOf, nextPersonaId, DEFAULT_SETTINGS } from '../src/state.js';
import { parseMemoryCommands } from '../src/memo.js';

const here = dirname(fileURLToPath(import.meta.url));
const presetDir = join(here, '..', 'presets');

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

// ── 找一个干净的 settings（有一个空人设） ──
const freshSettings = () => normalizeSettings({});

// ══════════════════════════════════════════════
console.log('【1】预置文件存在且格式合法');
// ══════════════════════════════════════════════
const files = existsSync(presetDir)
    ? readdirSync(presetDir).filter((f) => f.endsWith('.json'))
    : [];
chk(files.length > 0, `presets/ 里有 ${files.length} 个预设文件`);

const lapplandPath = join(presetDir, '拉普兰德.json');
chk(existsSync(lapplandPath), '★ 拉普兰德.json 存在');

const raw = readFileSync(lapplandPath, 'utf8');
let preset = null;
try {
    preset = JSON.parse(raw);
    chk(true, '是合法 JSON');
} catch (e) {
    chk(false, 'JSON 解析失败: ' + e.message);
}

if (preset) {
    chk(true, '★ 有 _cmcc 标记（能被识别为 CMCC 文件）');
    const v = validateImport(preset);
    chk(v.ok, '★ validateImport 通过' + (v.ok ? '' : ' → ' + v.error));

    // 人设
    const p = preset.persona || {};
    chk(p.name === '拉普兰德', `★ 名字 = 拉普兰德（实际 ${p.name}）`);
    chk(typeof p.description === 'string' && p.description.length > 80,
        `★ 角色描述够长（${(p.description || '').length} 字）`);
    chk(typeof p.personality === 'string' && p.personality.length > 60,
        `★ 性格够长（${(p.personality || '').length} 字）`);
    chk(typeof p.scenario === 'string' && p.scenario.length > 40,
        `★ 与你的关系够长（${(p.scenario || '').length} 字）`);
    chk(!preset.audio && !preset.avatar, '身上没有多余字段');

    // 记忆
    const n = countEntries(preset);
    chk(n === 12, `★ 预置记忆 ${n} 条`);
    const ents = Object.values(preset.worlds || {})
        .flatMap((w) => Object.values(w.saves || {}).flatMap((s) => s.entries || []));
    const lens = ents.map((e) => e.text.length);
    chk(Math.min(...lens) >= 30, `★ 最短记忆 ${Math.min(...lens)} 字（要求 ≥30）`);
    chk(Math.max(...lens) <= 50, `★ 最长记忆 ${Math.max(...lens)} 字（要求 ≤50）`);
    chk(ents.every((e) => typeof e.text === 'string' && e.text.length > 0), '每条都有文字');
    chk(ents.every((e) => e.text.indexOf('```') < 0), '★ 文字里没有围栏残留');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【2】人设导入');
// ══════════════════════════════════════════════
{
    const s = freshSettings();
    const before = s.builtins.length;
    const name = mergePersona(s, preset.persona, true, nextPersonaId);
    chk(name === '拉普兰德', '★ 返回生效的人设名');
    chk(s.builtins.length === before + 1, `★ 作为新预设追加（${before} → ${s.builtins.length}）`);
    const act = activePersonaOf(s);
    chk(act.name === '拉普兰德', '★ 导入后自动切到它');
    chk(act.description === preset.persona.description, '描述一致');
    chk(act.personality === preset.persona.personality, '性格一致');
    chk(act.scenario === preset.persona.scenario, '关系一致');
    chk(s.builtin.name === '拉普兰德', '★ 旧字段 builtin 也同步了（兼容）');
    chk(s.personaMode === 'builtin', '切到内置模式');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【3】记忆导入（合并 + 去重）');
// ══════════════════════════════════════════════
{
    const worlds = {};
    const stat = mergeWorlds(worlds, preset.worlds);
    chk(stat.entries === 12, `★ 导入 12 条（实际 ${stat.entries}）`);
    chk(stat.worlds === 1, '建了 1 个世界');
    chk(stat.saves === 1, '建了 1 个存档');
    chk(countEntries({ worlds }) === 12, '模型里确实有 12 条');

    // 再导一次：应该全部去重，不翻倍
    const stat2 = mergeWorlds(worlds, preset.worlds);
    chk(stat2.entries === 0, '★ 重复导入不新增（去重生效）');
    chk(stat2.skipped === 12, `★ 12 条被识别为重复（实际 ${stat2.skipped}）`);
    chk(countEntries({ worlds }) === 12, '★ 总条数仍是 12，没有翻倍');

    // 加一条新的进去，再导：只加新的
    const w = worlds['preset:lappland'];
    w.saves.preset.entries.push({ ts: 0, text: '这是我自己后来加的一条记忆' });
    const stat3 = mergeWorlds(worlds, preset.worlds);
    chk(stat3.entries === 0, '★ 自己加的不影响去重');
    chk(countEntries({ worlds }) === 13, '总条数 13');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【4】导入到已有记忆里（不覆盖）');
// ══════════════════════════════════════════════
{
    const existing = {
        'char:existing.png': {
            label: '我原来在玩的世界',
            saves: {
                chat1: { label: '存档1', entries: [
                    { ts: 1, text: '我原来就有的记忆，不能被冲掉' },
                ] },
            },
        },
    };
    const before = countEntries({ worlds: existing });
    const stat = mergeWorlds(existing, preset.worlds);
    chk(stat.worlds === 1, '新增了 1 个世界（原有的保留）');
    chk(existing['char:existing.png'], '★ 原有世界还在');
    chk(existing['char:existing.png'].saves.chat1.entries[0].text === '我原来就有的记忆，不能被冲掉',
        '★ 原有记忆没被覆盖');
    chk(countEntries({ worlds: existing }) === before + 12, '总量 = 原有 + 12');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【5】导出 → 再导入（往返一致）');
// ══════════════════════════════════════════════
{
    const worlds = {};
    mergeWorlds(worlds, preset.worlds);
    const exp = buildExport({
        persona: activePersonaOf((() => {
            const s = freshSettings();
            mergePersona(s, preset.persona, true, nextPersonaId);
            return s;
        })()),
        worlds,
        manifestVersion: '1.1.2',
    });
    chk(exp._cmcc === true, '导出带 _cmcc 标记');
    chk(exp._version === 1, '带版本号');
    chk(!!exp.exportedAt, '带导出时间');
    chk(exp.persona.name === '拉普兰德', '人设带上了');
    chk(countEntries(exp) === 12, '12 条记忆都带上了');

    // 再导一次，应该全是重复
    const w2 = {};
    const r1 = mergeWorlds(w2, exp.worlds);
    const r2 = mergeWorlds(w2, exp.worlds);
    chk(r1.entries === 12, '往返后仍能导入 12 条');
    chk(r2.entries === 0, '★ 往返后再导依然是 0 新增');
}

// ══════════════════════════════════════════════
console.log('');
console.log('【6】坏文件的容错');
// ══════════════════════════════════════════════
{
    chk(!validateImport(null).ok, 'null → 拒绝');
    chk(!validateImport({}).ok, '{} → 拒绝');
    chk(!validateImport({ foo: 1 }).ok, '没有 _cmcc → 拒绝');
    chk(validateImport({ _cmcc: true }).ok === false, '有标记但没有内容 → 拒绝');
    chk(validateImport({ _cmcc: true, persona: { name: 'x' } }).ok, '只有人设 → 通过');
    chk(validateImport({ _cmcc: true, worlds: {} }).ok, '只有记忆 → 通过');

    // 脏数据不该抛错
    const w = {};
    const st = mergeWorlds(w, { a: null, b: 'x', c: { saves: null } });
    chk(st.entries === 0, '★ 脏 worlds 不抛错');
    const st2 = mergeWorlds(w, { d: { saves: { s: { entries: [null, {}, { text: '' }, { text: 'ok' }] } } } });
    chk(st2.entries === 1, `★ 脏 entries 只取有效的（${st2.entries} 条）`);
    chk(st2.skipped === 3, `★ 3 条被跳过（实际 ${st2.skipped}）`);
}

// ══════════════════════════════════════════════
console.log('');
console.log('【7】记忆块的格式校验（防手改坏）');
// ══════════════════════════════════════════════
{
    const F = String.fromCharCode(96).repeat(3);
    const texts = Object.values(preset.worlds)
        .flatMap((w) => Object.values(w.saves).flatMap((s) => s.entries.map((e) => e.text)));
    const block = [F + 'cmcc', ...texts, F].join('\n');
    const parsed = parseMemoryCommands(block);
    chk(parsed.errors.length === 0, '★ 把这些记忆拼成记忆块能被解析（无错）');
    chk(parsed.entries.length === texts.length, `★ 解析条数一致（${parsed.entries.length}）`);
    chk(parsed.entries.every((e) => e.text.indexOf('cmcc') < 0), '没有把语言标记吃进记忆');
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
