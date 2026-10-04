/**
 * 设置页抽屉交互测试（假 DOM，但**真的执行点击回调**）
 * 目的：验证「点击 → 状态切换 → 再点击 → 还原」这条链不断
 * 用法: node tests/_click_test.mjs
 */

let __listeners = [];

class CL {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach((x) => x && this.s.add(x)); }
    remove(...c) { c.forEach((x) => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); }
    toString() { return [...this.s].join(' '); }
}

class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.classList = new CL();
        this.style = { removeProperty(k) { delete this[k]; }, setProperty(k, v) { this[k] = v; } };
        this._h = 120;
    }
    set className(v) { this.classList = new CL(); String(v || '').split(/\s+/).forEach((c) => c && this.classList.add(c)); }
    get className() { return this.classList.toString(); }
    set textContent(v) { this._text = String(v); }
    get textContent() { return (this._text || '') + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(v) { this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    setAttribute(k, v) { this.attributes = this.attributes || {}; this.attributes[k] = v; }
    getAttribute() { return undefined; }
    addEventListener(type, fn) {
        // 记录下来，测试里手动触发
        this._ls = this._ls || {};
        (this._ls[type] = this._ls[type] || []).push(fn);
        if (this.classList.contains('inline-drawer-header')) __listeners.push({ el: this, type, fn });
    }
    removeEventListener() {}
    dispatchEvent() { return true; }
    querySelector(sel) {
        return this._find((c) => c.matchesSel && c.matchesSel(sel)) || null;
    }
    querySelectorAll(sel) { const r = []; this._walk((c) => { if (c.matchesSel && c.matchesSel(sel)) r.push(c); }); return r; }
    _walk(fn) { for (const c of this.children) { fn(c); c._walk(fn); } }
    _find(pred) { let r = null; this._walk((c) => { if (!r && pred(c)) r = c; }); return r; }
    closest() { return null; }
    contains() { return false; }
    matchesSel(sel) {
        // 只支持测试里用到的几种
        if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
        if (sel.startsWith('#')) return this.id === sel.slice(1);
        return false;
    }
    getBoundingClientRect() {
        // 模拟"被 max-height 压住时高度为 0"
        const mh = this.style.maxHeight;
        if (this.style.display === 'none') return { width: 100, height: 0, top: 0, left: 0 };
        if (mh === '0px') return { width: 100, height: 0, top: 0, left: 0 };
        return { width: 100, height: this._h, top: 0, left: 0 };
    }
    get offsetHeight() { return this.getBoundingClientRect().height; }
    get scrollHeight() { return this._h; }
    scrollIntoView() {}
}

globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
    getElementById: (id) => (globalThis.__reg.get(id) || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new El('body'),
    documentElement: new El('html'),
};
globalThis.__reg = new Map();
globalThis.window = { addEventListener: () => {} };
globalThis.getComputedStyle = () => ({ display: 'block', maxHeight: '', paddingTop: '0', paddingBottom: '0' });
globalThis.MouseEvent = class {};

const host = new El('div');
host.id = 'extensions_settings2';
globalThis.__reg.set('extensions_settings2', host);

const { renderPanel } = await import('../src/ui.js');
const noop = () => {};
const ctx = {
    characters: [], callGenericPopup: async () => null,
    POPUP_TYPE: { INPUT: 1, CONFIRM: 2, TEXT: 3 },
    toastr: { info: noop, success: noop, warning: noop, error: noop },
};
const api = {
    snapshot: () => ({ bookName: 'x', stats: { worldCount: 0, totalEntries: 0, worlds: [] }, shared: [] }),
    currentPos: () => ({ wKey: 'w', sKey: 's', wLabel: 'W' }),
    summarize: noop, reload: async () => {}, addMemory: async () => {},
    cleanEmpty: async () => ({ saves: 0, worlds: 0 }),
    setCompanion: async () => {}, setBuiltin: async () => {}, setPersonaMode: async () => {},
};

renderPanel({
    settings: { personaMode: 'builtin', builtin: {} }, onSave: noop, ctx, api, onOpenTop: noop,
});

const panel = host.children[0];
const content = panel.querySelector('.inline-drawer-content');
const header = panel.querySelector('.inline-drawer-header');
const chev = panel.querySelector('.inline-drawer-icon');

console.log('=== 初始状态 ===');
console.log('  找得到 header / content:', !!header, '/', !!content);
console.log('  display =', JSON.stringify(content.style.display));
console.log('  maxHeight =', JSON.stringify(content.style.maxHeight));
console.log('  高度 =', content.getBoundingClientRect().height);
console.log('  箭头 up? ', chev.classList.contains('up'));

function fire(el, type) {
    const ls = (el._ls && el._ls[type]) || [];
    ls.forEach((fn) => fn({ stopPropagation() {}, preventDefault() {}, target: el }));
    return ls.length;
}

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('');
console.log('=== 点第 1 次（应收起）===');
const n1 = fire(header, 'click');
console.log('  触发监听器数 =', n1);
console.log('  display =', JSON.stringify(content.style.display), '| maxHeight =', JSON.stringify(content.style.maxHeight));
console.log('  高度 =', content.getBoundingClientRect().height);
chk(n1 >= 1, '★ header 上有 click 监听器（没有的话点不动）');
chk(chev.classList.contains('down'), '箭头变成 down');
chk(content.getBoundingClientRect().height === 0, '★ 高度收成 0');

console.log('');
console.log('=== 点第 2 次（应展开）===');
fire(header, 'click');
console.log('  display =', JSON.stringify(content.style.display), '| maxHeight =', JSON.stringify(content.style.maxHeight));
console.log('  高度 =', content.getBoundingClientRect().height);
chk(chev.classList.contains('up'), '箭头变回 up');
chk(!!content.style.display && content.style.display !== 'none', '★ display 不是 none');
chk(content.style.maxHeight !== '0px', '★ maxHeight 不是 0（这条最关键）');

console.log('');
console.log('=== 点第 3 次（再收起）===');
fire(header, 'click');
chk(chev.classList.contains('down'), '箭头又变 down');
chk(content.style.maxHeight === '0px' || content.style.display === 'none', '再次收起');

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
