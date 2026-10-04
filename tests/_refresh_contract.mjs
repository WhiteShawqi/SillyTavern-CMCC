/**
 * 回归测试：设置面板的 refresh() 必须**无条件**重建内容
 *
 * 对应真实 bug（用户报的）：
 *   「导入之后无法正常显示；删除人设预设也没办法删除
 *    （只留下名字，预设没删除，但其他内容没了）」
 *
 * 根因：refresh() 原来**只更新「记忆总览」**，从不重建人设下拉和那四个输入框。
 *   · 删掉一个人设后 activeBuiltinId 变了，界面还显示旧的 → 看着像"没删掉"
 *   · 更糟：那些输入框的 onchange 会把**旧内容写进新激活的人设**
 *
 * 为什么用**源码结构断言**而不是跑 DOM：
 *   我用假 DOM 试过，但假 DOM 的行为（classList / innerHTML / 查询）
 *   和真浏览器有微妙差异，折腾半天在 debug 假 DOM 自己。
 *   而这个 bug 的本质是**代码结构不对**（有条件分支），
 *   结构是对的，行为就不会错 —— 直接断言结构更可靠、也更好维护。
 *
 * 真浏览器的行为由 tests/layout/ 的页面验证。
 *
 * 用法: node tests/_refresh_contract.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

/** 取出一个函数的完整源码（按花括号配对） */
function bodyOf(code, signature) {
    const i = code.indexOf(signature);
    if (i < 0) return null;
    const open = code.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < code.length; j++) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}') {
            depth--;
            if (depth === 0) return code.slice(i, j + 1);
        }
    }
    return null;
}

console.log('【1】refresh() 必须无条件重建');
{
    const body = bodyOf(src, 'function refresh()');
    chk(!!body, '★ 找得到 function refresh()');

    if (body) {
        chk(body.includes('rebuildInner('), '★ refresh() 里调了 rebuildInner()');
        // 关键：不能有任何条件包着它
        chk(!/if\s*\([^)]*\)\s*\{\s*try\s*\{\s*rebuildInner/.test(body),
            '★★ rebuildInner() 没有被 if 条件包着');
        chk(!/if\s*\(rebuild/.test(body),
            '★★ 没有 refresh(rebuild) 这种条件重建的参数');
        chk(!/function\s+refresh\s*\(\s*rebuild/.test(src),
            '★ refresh 不接受 rebuild 参数');
        chk(!src.includes('refresh(true)'),
            '★ 调用点没有 refresh(true)（参数已取消）');
    }
}

console.log('');
console.log('【2】rebuildInner() 必须重建人设相关的一切');
{
    const body = bodyOf(src, 'function rebuildInner()');
    chk(!!body, '★ 找得到 function rebuildInner()');
    if (body) {
        chk(body.includes("inner.innerHTML = ''") || body.includes('inner.innerHTML=""'),
            '★ 先清空内容');
        // 人设栏 / 导出导入栏 / 四个输入框 / 记忆总览 —— 都得在它里面
        for (const [needle, label] of [
            ['cmcc-pbar', '人设预设栏 / 导出导入栏'],
            ['cmcc-select', '人设下拉框'],
            ['listPersonas', '读人设列表'],
            ['api.setBuiltin', '四个编辑字段的保存'],
            ['cmcc-ov-head', '记忆总览'],
            ['cmcc-support', '赞助按钮'],
        ]) {
            chk(body.includes(needle), `★ rebuildInner 里有「${label}」`);
        }
    }
}

console.log('');
console.log('【3】结构性操作后必须调 refresh()');
{
    // 这些操作会改变人设列表或当前人设，之后必须刷新
    const NEED = [
        ['api.setPersonaMode(', '切换来源（内置/角色卡）'],
        ['api.setActivePersona(', '切换人设'],
        ['api.addPersona(name, false)', '新建人设'],
        ['api.addPersona(name, true)', '复制人设'],
        ['api.deletePersona(', '删除人设'],
        ['api.renamePersona(', '重命名人设'],
    ];
    for (const [call, label] of NEED) {
        const i = src.indexOf(call);
        if (i < 0) { chk(false, `找不到 ${label}（${call}）`); continue; }
        // 从调用点往后 400 字符内应有 refresh()
        const after = src.slice(i, i + 400);
        chk(after.includes('refresh()'), `★ 「${label}」之后调了 refresh()`);
    }
}

console.log('');
console.log('【4】导出 / 导入也在里面（这两个以前最容易出问题）');
{
    const body = bodyOf(src, 'function rebuildInner()');
    if (body) {
        // 剥掉注释再查 —— 说明旧 bug 的注释里会提到 !!ok，那不是代码
        const code = body
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        chk(body.includes('exportAll'), '★ 导出按钮在 rebuildInner 里');
        chk(body.includes('importAll'), '★ 导入按钮在 rebuildInner 里');
        chk(body.includes('customButtons'), '★ 导入对话框用自定义按钮（新建/覆盖/取消）');
        chk(!code.includes('!!ok'), '★★ 代码里没有 !!ok（那会把"点否"当成"覆盖"）');
        chk(code.includes('choice'), '★ 导入用三选项的返回值判断');
    }
}

console.log('');
console.log('【5】不能出现未定义的标识符（上次栽过）');
{
    for (const bad of ['LOG_TAG', 'measureInner', 'cmcc-animated']) {
        chk(!src.includes(bad), `★ 没有残留的 ${bad}`);
    }
    // refreshStats 里引用的元素必须在外层声明
    chk(/let ovSummary = null;/.test(src), '★ ovSummary 在外层声明');
    chk(/let stats = null;/.test(src), '★ stats 在外层声明');
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
