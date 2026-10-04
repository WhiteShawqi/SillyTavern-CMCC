/**
 * topbar 渲染测试（假 DOM，但真的执行渲染）
 * 目的：验证 renderTopPanel 到底能不能渲染出内容
 *   —— 用户的 Console 里一直报「面板为空，补渲染」，说明 body 是空的
 * 用法: node tests/_topbar_test.mjs
 */

const reg = new Map();

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
        this.style = {};
        this._text = '';
        this._html = '';
        this.id = '';
        this.title = '';
        this._ls = {};
    }
    set className(v) { this.classList = new CL(); String(v || '').split(/\s+/).forEach((c) => c && this.classList.add(c)); }
    get className() { return this.classList.toString(); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(v) { this._html = String(v); }
    get innerHTML() { return this._html; }
    appendChild(c) {
        c.parentElement = this; this.children.push(c);
        if (c.id) reg.set(c.id, c);
        // 递归注册后代的 id
        c._walk((x) => { if (x.id) reg.set(x.id, x); });
        return c;
    }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    setAttribute(k, v) { this._attr = this._attr || {}; this._attr[k] = v; }
    getAttribute(k) { return (this._attr || {})[k]; }
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
    removeEventListener() {}
    dispatchEvent() { return true; }
    querySelector(sel) { return this._find(sel); }
    querySelectorAll(sel) {
        const r = [];
        this._walk((c) => { if (this._m(c, sel)) r.push(c); });
        return r;
    }
    _walk(fn) { for (const c of this.children) { fn(c); c._walk(fn); } }
    _find(sel) { let r = null; this._walk((c) => { if (!r && this._m(c, sel)) r = c; }); return r; }
    _m(c, sel) {
        // 支持逗号分隔的简单选择器
        return String(sel).split(',').some((one) => {
            const s = one.trim();
            if (s.startsWith('#')) return c.id === s.slice(1);
            if (s.startsWith('.')) return c.classList.contains(s.slice(1));
            return c.tagName === s.toUpperCase();
        });
    }
    closest(sel) { let e = this; while (e) { if (this._m(e, sel)) return e; e = e.parentElement; } return null; }
    contains(c) { let e = c; while (e) { if (e === this) return true; e = e.parentElement; } return false; }
    matches(sel) { return this._m(this, sel); }
    getBoundingClientRect() {
        if (this.style.display === 'none') return { width: 0, height: 0, top: 0, left: 0 };
        return { width: 500, height: 100, top: 0, left: 0 };
    }
    get offsetHeight() { return this.getBoundingClientRect().height; }
    get scrollHeight() { return 100; }
    scrollIntoView() {}
}

globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
    getElementById: (id) => reg.get(id) || null,
    querySelector: (s) => { for (const e of reg.values()) { const r = e.querySelector(s); if (r) return r; } return null; },
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new El('body'),
    documentElement: new El('html'),
};
globalThis.window = { addEventListener: () => {} };
globalThis.getComputedStyle = () => ({ display: 'block', maxHeight: '', paddingTop: '0', paddingBottom: '0', overflowY: 'visible' });
globalThis.MouseEvent = class {};
try { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true }); } catch (e) {}

// top-settings-holder 要有
const holder = new El('div');
holder.id = 'top-settings-holder';
reg.set('top-settings-holder', holder);

const { mountTopDrawer, renderTopPanel, openTopPanel } = await import('../src/topbar.js');

const ctx = {
    characters: [{ name: '小满', avatar: 'x.png' }],
    callGenericPopup: async () => null,
    POPUP_TYPE: { INPUT: 1, CONFIRM: 2, TEXT: 3 },
    toastr: { info() {}, success() {}, warning() {}, error() {} },
    powerUserSettings: {},
};
const api = {
    snapshot: () => ({
        bookName: 'CMCC-记忆库',
        personaMode: 'builtin',
        companionName: '小满',
        hasCompanion: true,
        injectMemory: true,
        builtin: { name: '小满', description: 'd', personality: 'p', scenario: 's' },
        stats: { worldCount: 1, totalEntries: 3, sharedCount: 0, worlds: [
            { key: 'w1', label: '世界A', saveCount: 1, count: 3, worldEntryCount: 0,
              saves: [{ key: 's1', label: '存档1', count: 3 }] },
        ] },
        shared: [],
        worlds: { w1: { label: '世界A', saves: { s1: { label: '存档1',
            entries: [{ text: '一件事' }, { text: '两件事' }] } } } },
    }),
    currentPos: () => ({ wKey: 'w1', sKey: 's1', wLabel: '世界A' }),
    summarize() {}, reload: async () => {}, addMemory: async () => {},
    addShared: async () => {}, editShared: async () => {}, deleteShared: async () => {},
    editMemory: async () => {}, deleteMemory: async () => {}, deleteMemories: async () => 0,
    deleteSave: async () => {}, renameSave: async () => {}, renameWorld: async () => {},
    editPersona: async () => {}, cleanEmpty: async () => ({ saves: 0, worlds: 0 }),
    deleteByScope: async () => ({ deleted: 0, what: '' }),
};

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('=== mountTopDrawer ===');
try {
    mountTopDrawer();
    console.log('  drawer 存在:', !!document.getElementById('cmcc-top-drawer'));
    console.log('  panel  存在:', !!document.getElementById('cmcc-top-panel'));
    console.log('  body   存在:', !!document.getElementById('cmcc-top-panel_body'));
    chk(!!document.getElementById('cmcc-top-panel_body'), '骨架建出来了');
} catch (e) {
    console.log('  ❌ mountTopDrawer 抛错:', e.message);
    fail++;
}

console.log('');
console.log('=== renderTopPanel ===');
const body = document.getElementById('cmcc-top-panel_body');
try {
    renderTopPanel({ ctx, api, onGotoSettings() {} });
    console.log('  body 子元素数:', body.children.length);
    chk(body.children.length > 0, '★ 渲染出内容了（不是空的）');
    if (body.children.length === 0) {
        console.log('  ! body.innerHTML 长度:', body.innerHTML.length);
    }
} catch (e) {
    console.log('  ❌ renderTopPanel 抛错:');
    console.log('     ', e.message);
    console.log('     ', (e.stack || '').split('\n').slice(0, 5).join('\n      '));
    fail++;
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
