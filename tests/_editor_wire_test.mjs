/**
 * 端到端：模拟 index.js 的接线，验证「打开编辑器」链路
 *
 * 验的是真实调用链：
 *   ui.js 的按钮 → onOpenEditor() → api.openEditor() → editor.js 的 openEditor()
 *   → buildEditor() → ctx.callGenericPopup(root, ...)
 *
 * 用假 DOM + 假的 callGenericPopup，检查弹窗里收到的确实是编辑器元素。
 *
 * 用法: node tests/_editor_wire_test.mjs
 */

// ── 极简假 DOM ──
class CL {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach((x) => x && this.s.add(x)); }
    remove(...c) { c.forEach((x) => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c, on) { if (on === undefined) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); } else if (on) this.s.add(c); else this.s.delete(c); }
    toString() { return [...this.s].join(' '); }
}
const reg = new Map();
class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.children = []; this.parentElement = null;
        this.classList = new CL();
        this.style = {
            removeProperty(k) { delete this[k]; },
            setProperty(k, v) { this[k] = v; },
        };
        this.id = ''; this.type = ''; this.value = ''; this.checked = false;
        this.disabled = false; this.placeholder = ''; this.title = ''; this.rows = 0;
        this._ls = {}; this._text = ''; this._html = ''; this.dataset = {};
    }
    set className(v) { this.classList = new CL(); String(v || '').split(/\s+/).forEach((c) => c && this.classList.add(c)); }
    get className() { return this.classList.toString(); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() {
        // 真浏览器里 innerHTML 赋的文字也算 textContent。
        // 假 DOM 必须照做 —— 否则用 el(tag, cls, '文字') 建的按钮会被判为没有文字。
        const own = this._html ? String(this._html).replace(/<[^>]*>/g, '') : '';
        return this._text + own + this.children.map((c) => c.textContent).join('');
    }
    set innerHTML(v) { this._html = String(v); if (this._html === '') this.children = []; }
    get innerHTML() { return this._html; }
    appendChild(c) {
        if (!c) return c;
        c.parentElement = this; this.children.push(c);
        if (c.id) reg.set(c.id, c);
        c._walk((x) => { if (x.id) reg.set(x.id, x); });
        return c;
    }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    setAttribute() {} getAttribute() { return undefined; }
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
    removeEventListener() {} dispatchEvent() { return true; }
    click() {
        // 代码里两种写法都有：addEventListener('click', fn) 和 el.onclick = fn。
        // 真浏览器两种都会触发，假 DOM 也要。
        const ev = { stopPropagation() {}, preventDefault() {} };
        if (typeof this.onclick === 'function') this.onclick(ev);
        (this._ls.click || []).forEach((fn) => fn(ev));
    }
    querySelector(sel) { return this._find(sel); }
    querySelectorAll(sel) { const r = []; this._walk((c) => { if (this._m(c, sel)) r.push(c); }); return r; }
    _walk(fn) { for (const c of this.children) { fn(c); c._walk(fn); } }
    _find(sel) { let r = null; this._walk((c) => { if (!r && this._m(c, sel)) r = c; }); return r; }
    _m(c, sel) {
        return String(sel).split(',').some((one) => {
            const s = one.trim();
            if (s.startsWith('#')) return c.id === s.slice(1);
            if (s.startsWith('.')) return c.classList.contains(s.slice(1));
            if (s.startsWith('input')) return c.tagName === 'INPUT';
            return c.tagName === s.toUpperCase();
        });
    }
    closest(sel) { let e = this; while (e) { if (this._m(e, sel)) return e; e = e.parentElement; } return null; }
    contains() { return false; }
    getBoundingClientRect() { return { width: 500, height: 200, top: 0, left: 0 }; }
    get offsetHeight() { return 100; } get scrollHeight() { return 100; }
    scrollIntoView() {}
}
globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
    getElementById: (id) => reg.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, body: new El('body'), documentElement: new El('html'),
};
globalThis.window = { addEventListener: () => {} };
globalThis.getComputedStyle = () => ({ display: 'block' });
globalThis.Blob = class {}; globalThis.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
globalThis.fetch = async () => { throw new Error('测试里不该真的 fetch'); };

const host = new El('div'); host.id = 'extensions_settings2'; reg.set('extensions_settings2', host);

const { renderPanel } = await import('../src/ui.js');
const { buildEditor } = await import('../src/editor.js');

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

// ── 记录弹窗收到了什么 ──
let popupCalls = [];
const noop = () => {};
const ctx = {
    characters: [{ name: '小满', avatar: 'x.png' }],
    callGenericPopup: async (content, type, input, opts) => {
        popupCalls.push({ content, type, input, opts });
        return null;
    },
    POPUP_TYPE: { INPUT: 1, CONFIRM: 2, TEXT: 3, DISPLAY: 4 },
    toastr: { info: noop, success: noop, warning: noop, error: noop },
    powerUserSettings: {},
};

const settings = {
    personaMode: 'builtin',
    builtin: { name: '小满', description: 'D', personality: 'P', scenario: 'S' },
    builtins: [{ id: 'p1', name: '小满', description: 'D', personality: 'P', scenario: 'S' }],
    activeBuiltinId: 'p1',
    tokenBudget: 2400, memoryBudget: 1800, recentMemoryLimit: 10, relevantMemoryLimit: 5,
};
const WORLDS = {
    w1: { label: '世界A', saves: {
        s1: { label: '存档1', entries: [{ text: '第一条' }, { text: '第二条' }] },
    } },
};
const api = {
    snapshot: () => ({
        bookName: 'CMCC-记忆库', personaMode: 'builtin', companionName: '小满',
        hasCompanion: true, injectMemory: true, companionAvatar: 'x.png',
        builtin: settings.builtin,
        stats: { worldCount: 1, totalEntries: 2, sharedCount: 0, worlds: [
            { key: 'w1', label: '世界A', saveCount: 1, count: 2,
              saves: [{ key: 's1', label: '存档1', count: 2 }] },
        ] },
        shared: [], worlds: WORLDS,
    }),
    currentPos: () => ({ wKey: 'w1', sKey: 's1', wLabel: '世界A' }),
    listPersonas: () => settings.builtins.map((x) => ({ id: x.id, name: x.name })),
    setActivePersona: async () => true, addPersona: async () => 'x',
    deletePersona: async () => true, renamePersona: async () => true,
    exportAll: async () => ({ worlds: WORLDS }), importAll: async () => ({}),
    setBuiltin: async () => {}, setPersonaMode: async () => {},
    summarize: noop, reload: async () => {}, addMemory: async () => {},
    editMemory: async () => {}, deleteMemory: async () => {},
    deleteMemories: async () => 0, deleteSave: async () => {},
    renameSave: async () => {}, renameWorld: async () => {},
    editPersona: async () => {}, cleanEmpty: async () => ({ saves: 0, worlds: 0 }),
    deleteByScope: async () => ({ deleted: 0, what: '' }),
    refreshTop: noop,
    setCompanion: async () => {},
};

console.log('【1】设置页里有没有「打开编辑器」按钮');
let clicked = 0;
const panel = renderPanel({
    settings, onSave: noop, ctx, api,
    onOpenEditor: () => { clicked++; },
});
const root = host.children[0];
const inner = root.querySelector('.cmcc-drawer-inner');
const btns = inner.querySelectorAll('button');
const openBtn = btns.find((b) => (b.textContent || '').includes('打开编辑器'));
chk(!!openBtn, '★ 找得到「打开编辑器」按钮');
if (openBtn) {
    chk(openBtn.classList.contains('cmcc-primary-btn'), '★ 是主按钮样式（显眼）');
    openBtn.click();
    await Promise.resolve();
    chk(clicked === 1, `★ 点了会触发 onOpenEditor（实际 ${clicked} 次）`);
}

console.log('');
console.log('【2】模拟 index.js 的 api.openEditor() 链路');
// 这就是 index.js 里 api.openEditor() 干的事
const fakeApi = Object.assign({}, api, {
    openEditor() {
        const root = buildEditor({ ctx, api: fakeApi, version: '1.3.3' });
        root.id = 'cmcc-editor-popup';
        ctx.callGenericPopup(root, ctx.POPUP_TYPE.TEXT, '', {
            wide: true, large: true, okButton: '关闭', allowVerticalScrolling: true,
        });
    },
});

popupCalls = [];
fakeApi.openEditor();
await Promise.resolve();

chk(popupCalls.length === 1, `★ 弹窗被调了一次（实际 ${popupCalls.length}）`);
const call = popupCalls[0] || {};
chk(call.type === 3, '★ 用的是 POPUP_TYPE.TEXT（能装任意内容）');
chk(call.content && call.content.classList, '★ 传给弹窗的是元素，不是字符串');
chk(call.content && call.content.classList.contains('cmcc-editor'),
    '★ 元素上有 .cmcc-editor');
chk(call.opts && call.opts.wide === true, '★ 传了 wide（弹窗够宽）');
chk(call.opts && typeof call.opts.okButton === 'string', '★ 有 okButton 文字');

console.log('');
console.log('【3】弹窗里那个编辑器是完整的');
const ed = call.content;
if (ed) {
    chk(ed.querySelectorAll('.cmcc-tab').length === 4, `★ 4 个标签（实际 ${ed.querySelectorAll('.cmcc-tab').length}）`);
    chk(!!ed.querySelector('.cmcc-panes'), '★ 有内容区');
    chk(ed.querySelectorAll('.cmcc-tab-pane').length === 1, '★ 当前只渲染一个标签页');
    chk(typeof ed.cmccRefresh === 'function', '★ 挂了 cmccRefresh（供外部刷新）');
    chk(ed.id === 'cmcc-editor-popup', '★ id 是 cmcc-editor-popup（便于刷新定位）');
}

console.log('');
console.log('【4】refreshEditor() 能刷新已打开的编辑器');
{
    const { refreshEditor } = await import('../src/editor.js');
    // 放进 registry，让 getElementById 找得到
    reg.set('cmcc-editor-popup', ed);
    let threw = null;
    try { refreshEditor(); } catch (e) { threw = e.message; }
    chk(!threw, `★ refreshEditor() 不抛错${threw ? '：' + threw : ''}`);
    // 没打开时也应安静地什么都不做
    reg.delete('cmcc-editor-popup');
    let threw2 = null;
    try { refreshEditor(); } catch (e) { threw2 = e.message; }
    chk(!threw2, '★ 编辑器没打开时也不抛错（空操作）');
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
