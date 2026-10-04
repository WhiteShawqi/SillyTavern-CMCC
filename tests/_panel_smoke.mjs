/**
 * 设置面板渲染冒烟测试（含新版人设栏 / 导出导入栏）
 * 目的：renderPanel 不能抛错，且结构完整
 * 用法: node tests/_panel_smoke.mjs
 */

class CL {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach((x) => x && this.s.add(x)); }
    remove(...c) { c.forEach((x) => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); }
    toString() { return [...this.s].join(' '); }
}

const reg = new Map();

class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.classList = new CL();
        this.style = {
            removeProperty(k) { delete this[k]; },
            setProperty(k, v) { this[k] = v; },
        };
        this.id = '';
        this.type = '';
        this.value = '';
        this.checked = false;
        this.indeterminate = false;
        this.disabled = false;
        this.placeholder = '';
        this.title = '';
        this.rows = 0;
        this.files = null;
        this._ls = {};
        this._text = '';
        this._html = '';
    }
    set className(v) { this.classList = new CL(); String(v || '').split(/\s+/).forEach((c) => c && this.classList.add(c)); }
    get className() { return this.classList.toString(); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text; }
    set innerHTML(v) { this._html = String(v); }
    get innerHTML() { return this._html; }
    appendChild(c) {
        c.parentElement = this; this.children.push(c);
        if (c.id) reg.set(c.id, c);
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
    click() { (this._ls.click || []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} })); }
    querySelector(sel) { return this._find(sel); }
    querySelectorAll(sel) { const r = []; this._walk((c) => { if (this._m(c, sel)) r.push(c); }); return r; }
    _walk(fn) { for (const c of this.children) { fn(c); c._walk(fn); } }
    _find(sel) { let r = null; this._walk((c) => { if (!r && this._m(c, sel)) r = c; }); return r; }
    _m(c, sel) {
        return String(sel).split(',').some((one) => {
            const s = one.trim();
            if (s.startsWith('#')) return c.id === s.slice(1);
            if (s.startsWith('.')) return c.classList.contains(s.slice(1));
            return c.tagName === s.toUpperCase();
        });
    }
    closest(sel) { let e = this; while (e) { if (this._m(e, sel)) return e; e = e.parentElement; } return null; }
    contains(c) { let e = c; while (e) { if (e === this) return true; e = e.parentElement; } return false; }
    getBoundingClientRect() { return { width: 500, height: 100, top: 0, left: 0 }; }
    get offsetHeight() { return 100; }
    get scrollHeight() { return 100; }
    scrollIntoView() {}
}

globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
    getElementById: (id) => reg.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new El('body'),
    documentElement: new El('html'),
};
globalThis.window = { addEventListener: () => {} };
globalThis.getComputedStyle = () => ({ display: 'block', paddingTop: '0', paddingBottom: '0' });
globalThis.MouseEvent = class {};
globalThis.Blob = class { constructor(a) { this.a = a; } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };

const host = new El('div');
host.id = 'extensions_settings2';
reg.set('extensions_settings2', host);

const { renderPanel } = await import('../src/ui.js');

const settings = {
    enabled: true, personaMode: 'builtin',
    builtin: { name: '小满', description: '灰发', personality: '话少', scenario: '同伴' },
    builtins: [
        { id: 'p1', name: '小满', description: '灰发少女', personality: '话少', scenario: '同伴' },
        { id: 'p2', name: '阿米娅', description: '罗德岛领袖', personality: '沉稳', scenario: '' },
        { id: 'p3', name: '空壳', description: '', personality: '', scenario: '' },
    ],
    activeBuiltinId: 'p1',
    injectMemory: true, memoryBudget: 1800, tokenBudget: 2400,
    saveMemoryLimit: 500, recentMemoryLimit: 10, relevantMemoryLimit: 5,
    summarizeEvery: 12, summarizeCooldown: 90, announceSaveSwitch: true,
    syncWorldbook: true, readMemoryCommands: true, debug: false,
};
const noop = () => {};
const calls = [];
const ctx = {
    characters: [],
    callGenericPopup: async () => null,
    POPUP_TYPE: { INPUT: 1, CONFIRM: 2, TEXT: 3 },
    toastr: { info: noop, success: noop, warning: noop, error: noop },
};
const api = {
    snapshot: () => ({
        bookName: 'CMCC-记忆库',
        stats: { worldCount: 1, totalEntries: 3, sharedCount: 0, worlds: [
            { key: 'w1', label: '世界A', saveCount: 1, count: 3,
              saves: [{ key: 's1', label: '存档1', count: 3 }] },
        ] },
        shared: [],
    }),
    currentPos: () => ({ wKey: 'w1', sKey: 's1', wLabel: '世界A' }),
    listPersonas: () => settings.builtins.map((x) => ({
        id: x.id, name: x.name, active: x.id === settings.activeBuiltinId,
        descLen: (x.description || '').length,
    })),
    setActivePersona: async (id) => { calls.push('setActivePersona:' + id); return true; },
    addPersona: async (n, c) => { calls.push('addPersona:' + n + ':' + c); return 'new'; },
    deletePersona: async (id) => { calls.push('deletePersona:' + id); return true; },
    renamePersona: async (id, n) => { calls.push('renamePersona:' + id + ':' + n); return true; },
    exportAll: async () => ({ _cmcc: true, persona: { name: '小满' }, worlds: {} }),
    importAll: async () => ({ persona: 'x', worlds: 0, saves: 0, entries: 0 }),
    setBuiltin: async () => {}, setPersonaMode: async () => {},
    summarize: noop, reload: async () => {}, addMemory: async () => {},
    cleanEmpty: async () => ({ saves: 0, worlds: 0 }),
};

let pass = 0, fail = 0;
const chk = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

console.log('【设置面板渲染冒烟】');
let panel = null;
try {
    panel = renderPanel({ settings, onSave: noop, ctx, api, onOpenTop: noop });
    chk(true, '★ renderPanel 没抛错');
} catch (e) {
    chk(false, 'renderPanel 抛错: ' + e.message);
    console.log('   ', (e.stack || '').split('\n').slice(0, 4).join('\n    '));
}
chk(!!panel, '有返回值');
chk(host.children.length === 1, '挂到了 #extensions_settings2');

const root = host.children[0];
const content = root.querySelector('.inline-drawer-content');
const header = root.querySelector('.inline-drawer-header');
chk(!!header && !!content, '骨架完整（header + content）');

// 人设栏
const pbar = root.querySelector('.cmcc-pbar');
chk(!!pbar, '★ 人设预设栏渲染出来了');
const sels = root.querySelectorAll('.cmcc-pbar');
chk(sels.length >= 2, `★ 有 ${sels.length} 条工具条（人设栏 + 导出导入栏）`);

// 找下拉框里的选项数
let optCount = 0;
(function walk(n) {
    for (const c of n.children || []) {
        if (c.tagName === 'SELECT') optCount = Math.max(optCount, c.children.length);
        walk(c);
    }
})(root);
chk(optCount === 3, `★ 下拉里有 3 个人设（实际 ${optCount}）`);

// 删除按钮在人设只有 1 个时应禁用；现在 3 个，应可用
let delBtn = null;
(function walk(n) {
    for (const c of n.children || []) {
        if (c.classList && c.classList.contains('cmcc-danger') && c.tagName === 'BUTTON') delBtn = c;
        walk(c);
    }
})(root);
chk(!!delBtn, '有删除人设按钮');
chk(delBtn && delBtn.disabled === false, '★ 3 个人设时删除按钮可用');

// 展开 / 收起（只用 display）
const applyState = () => ({ d: content.style.display, h: content.getBoundingClientRect().height });
const h0 = applyState();
header.click();
const h1 = applyState();
header.click();
const h2 = applyState();
chk(h0.d === 'block', '初始展开（display:block）');
chk(h1.d === 'none', '★ 点一次 → display:none（收起）');
chk(h2.d === 'block', '★ 再点 → display:block（展开）');

// 刷新不抛错
try {
    if (panel && typeof panel.refresh === 'function') panel.refresh();
    chk(true, 'refresh() 没抛错');
} catch (e) {
    chk(false, 'refresh 抛错: ' + e.message);
}

console.log('');
console.log(fail === 0 ? `✓ 全部通过 (${pass} 项)` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
