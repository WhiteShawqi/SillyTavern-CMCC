/**
 * 三级级联勾选测试
 * 对应问题：勾「世界」(L1) 没带上存档和记忆；勾「存档」(L2) 没带上 L3
 * 用法: node tests/_cascade_test.mjs
 */

// topbar.js 模块顶层会调 document.addEventListener，Node 里给个最小桩
globalThis.document = globalThis.document || {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, setAttribute() {} }; },
    body: { appendChild() {} },
    documentElement: {},
};

import {
    setSaveEntries, setWorldAll, saveSelState, worldSelState,
    entryKey, saveKeyId, __selTestHook,
} from '../src/topbar.js';

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

const S = __selTestHook;
const W = 'char:A.png';

// 一个世界，3 个存档，分别 2 / 3 / 1 条记忆
const mem = {
    worlds: {
        [W]: {
            label: '世界A', saves: {
                s1: { label: '存档1', entries: [{ text: 'a1' }, { text: 'a2' }] },
                s2: { label: '存档2', entries: [{ text: 'b1' }, { text: 'b2' }, { text: 'b3' }] },
                s3: { label: '存档3', entries: [{ text: 'c1' }] },
            },
        },
        other: { label: '世界B', saves: { x: { label: 'X', entries: [{ text: 'x1' }] } } },
    },
};

console.log('【1】勾 L1（世界）→ 应带上全部 L2 和 L3');
S.clear(); S.setMode(true);
S.SELECTED_WORLDS.add(W);
setWorldAll(W, true, mem);
chk(S.SELECTED.size === 6, `★ L3 全部勾上（6 条，实际 ${S.SELECTED.size}）`);
chk(S.SELECTED_SAVES.size === 3, `★ L2 全部勾上（3 个，实际 ${S.SELECTED_SAVES.size}）`);
chk(S.SELECTED.has(entryKey(W, 's1', 0)), 's1 第 0 条被勾');
chk(S.SELECTED.has(entryKey(W, 's2', 2)), 's2 第 2 条被勾');
chk(S.SELECTED.has(entryKey(W, 's3', 0)), 's3 第 0 条被勾');
chk(!S.SELECTED.has(entryKey('other', 'x', 0)), '★ 不动别的世界');
chk(worldSelState(W, mem) === 'all', '★ 世界的状态 = 全选');
console.log('');

console.log('【2】取消 L1 → 应清掉全部下层');
S.SELECTED_WORLDS.delete(W);
setWorldAll(W, false, mem);
chk(S.SELECTED.size === 0, 'L3 全清');
chk(S.SELECTED_SAVES.size === 0, 'L2 全清');
chk(worldSelState(W, mem) === 'none', '世界状态 = 未选');
console.log('');

console.log('【3】勾 L2（存档）→ 应带上该档全部 L3，且只带该档');
S.clear();
const id2 = saveKeyId(W, 's2');
S.SELECTED_SAVES.add(id2);
setSaveEntries(W, 's2', true, mem);
chk(S.SELECTED.size === 3, `★ 只勾到 s2 的 3 条（实际 ${S.SELECTED.size}）`);
chk(S.SELECTED.has(entryKey(W, 's2', 1)), 's2 的记忆被勾');
chk(!S.SELECTED.has(entryKey(W, 's1', 0)), '★ s1 不受影响');
chk(!S.SELECTED.has(entryKey(W, 's3', 0)), '★ s3 不受影响');
chk(saveSelState(W, 's2', mem) === 'all', 's2 状态 = 全选');
chk(saveSelState(W, 's1', mem) === 'none', 's1 状态 = 未选');
console.log('');

console.log('【4】半选状态（部分勾选）');
S.clear();
S.SELECTED.add(entryKey(W, 's2', 0));   // s2 里只勾 1 条（共 3 条）
chk(saveSelState(W, 's2', mem) === 'some', `★ L2 半选（实际 ${saveSelState(W, 's2', mem)}）`);
chk(worldSelState(W, mem) === 'some', `★ L1 半选（实际 ${worldSelState(W, mem)}）`);
// 全勾 s2
S.SELECTED.add(entryKey(W, 's2', 1));
S.SELECTED.add(entryKey(W, 's2', 2));
chk(saveSelState(W, 's2', mem) === 'all', 's2 补齐后 = 全选');
chk(worldSelState(W, mem) === 'some', '★ 但世界仍是半选（只有 s2 全选）');
console.log('');

console.log('【5】真实场景：L2 取消勾选只清自己那档');
S.clear();
setWorldAll(W, true, mem);
chk(S.SELECTED.size === 6, '先全选');
const id1 = saveKeyId(W, 's1');
S.SELECTED_SAVES.delete(id1);
setSaveEntries(W, 's1', false, mem);
chk(S.SELECTED.size === 4, `★ s1 的 2 条被清掉，剩 4 条（实际 ${S.SELECTED.size}）`);
chk(S.SELECTED_SAVES.size === 2, '★ L2 剩 2 个');
chk(saveSelState(W, 's1', mem) === 'none', 's1 = 未选');
chk(saveSelState(W, 's2', mem) === 'all', 's2 仍全选');
chk(worldSelState(W, mem) === 'some', '世界 = 半选');
console.log('');

console.log('【6】边界');
S.clear();
setWorldAll('不存在', true, mem);            // 不该抛错
chk(S.SELECTED.size === 0, '不存在的世界 → 安全无操作');
chk(worldSelState('不存在', mem) === 'none', '不存在世界状态 = none');
const emptyMem = { worlds: { e: { label: 'E', saves: {} } } };
chk(worldSelState('e', emptyMem) === 'none', '空世界 → none');
setWorldAll('e', true, emptyMem);
chk(S.SELECTED.size === 0 && S.SELECTED_SAVES.size === 0, '空世界 → 无操作');
// 存档没有 entries
const noEnt = { worlds: { n: { label: 'N', saves: { z: { label: 'Z' } } } } };
chk(saveSelState('n', 'z', noEnt) === 'none', '无 entries 的存档 → none');
setSaveEntries('n', 'z', true, noEnt);
chk(S.SELECTED.size === 0, '无 entries → 不抛错');
S.clear();
console.log('');

console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
