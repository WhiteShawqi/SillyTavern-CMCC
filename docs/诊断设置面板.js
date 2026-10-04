/**
 * CMCC 设置面板 · 浏览器控制台诊断
 *
 * 用途：「点不开插件设置面板」时定位问题。
 * 用法：打开酒馆 → F12 → Console → 整段粘贴 → 回车
 *
 * 只读，不改任何数据。
 */
(() => {
    const R = [];
    const log = (s) => { R.push(s); console.log(s); };
    const ok = (c) => (c ? '✓' : '❌');

    log('════ CMCC 设置面板诊断 ════');

    // ① 面板元素存在吗
    const root = document.getElementById('cmcc_settings');
    log(`① 面板元素 #cmcc_settings        ${ok(root)}`);
    if (!root) {
        log('   → 说明 renderPanel 没执行成功，或抛错了。');
        log('   → 请看 Console 里有没有 [CMCC] 设置页面板挂载失败');
        log('');
        log('也可能是：ST 还没加载完。等 2 秒再跑一次这个脚本试试。');
        return R.join('\n');
    }

    // ② 结构
    const header = root.querySelector('.inline-drawer-header');
    const content = root.querySelector('.inline-drawer-content');
    const inner = root.querySelector('.cmcc-drawer-inner');
    const chev = root.querySelector('.inline-drawer-icon');
    log(`② header / content / inner / 箭头  ${ok(header)} ${ok(content)} ${ok(inner)} ${ok(chev)}`);

    // ③ 是否被事件监听（用 getEventListeners，仅 DevTools 支持）
    if (typeof getEventListeners === 'function') {
        const ls = header ? getEventListeners(header).click : null;
        log(`③ header 上的 click 监听器数量 ${ok(ls && ls.length)}  ${ls ? ls.length : 0}`);
        if (!ls || !ls.length) log('   → 监听器丢了！这就是点不动的原因。');
    } else {
        log('③ （getEventListeners 不可用，跳过）');
    }

    // ④ 当前状态
    const cs = content ? getComputedStyle(content) : null;
    log('④ 当前样式状态');
    log(`   inline display   = ${JSON.stringify(content?.style.display)}`);
    log(`   inline maxHeight = ${JSON.stringify(content?.style.maxHeight)}`);
    log(`   计算 display     = ${cs?.display}`);
    log(`   计算 maxHeight   = ${cs?.maxHeight}`);
    log(`   计算 overflow    = ${cs?.overflow}`);
    log(`   有 cmcc-animated ${ok(content?.classList.contains('cmcc-animated'))}`);
    log(`   箭头 up / down   = ${ok(chev?.classList.contains('up'))} / ${ok(chev?.classList.contains('down'))}`);
    log(`   实测高度         = ${Math.round(content?.getBoundingClientRect().height || 0)}`);

    // ⑤ 面板在页面上的可见位置
    const rr = root.getBoundingClientRect();
    log('⑤ 面板位置');
    log(`   top=${Math.round(rr.top)} left=${Math.round(rr.left)} w=${Math.round(rr.width)} h=${Math.round(rr.height)}`);
    const vis = rr.width > 0 && rr.height > 0 && cs?.display !== 'none';
    log(`   可见 ${ok(vis)}`);

    // ⑥ 祖先链上有没有 display:none / 高度 0
    log('⑥ 祖先链（找有没有被藏起来）');
    let p = root.parentElement;
    let depth = 0;
    let blocked = null;
    while (p && depth < 12) {
        const s = getComputedStyle(p);
        const pr = p.getBoundingClientRect();
        const tag = `<${p.tagName.toLowerCase()}${p.id ? '#' + p.id : ''}${p.className ? '.' + String(p.className).split(' ')[0] : ''}>`;
        log(`   ${'  '.repeat(depth)}${tag} display=${s.display} vis=${s.visibility} h=${Math.round(pr.height)}`);
        if (!blocked && (s.display === 'none' || pr.height === 0)) blocked = tag;
        p = p.parentElement;
        depth++;
    }
    if (blocked) log(`   ⚠ 第一个可疑的祖先：${blocked}`);

    // ⑦ CSS 规则是否加载
    let found = false;
    for (const sh of document.styleSheets) {
        try {
            for (const r of sh.cssRules || []) {
                if (r.selectorText && r.selectorText.includes('.cmcc-panel')) { found = true; break; }
            }
        } catch (e) { /* 跨域样式表忽略 */ }
        if (found) break;
    }
    log(`⑦ style.css 里的 .cmcc-panel 规则  ${ok(found)}`);
    if (!found) log('   → CSS 没加载，样式会全乱。');

    // ⑧ 试一试直接点
    log('⑧ 现在直接帮你点一下 header（观察下面的日志变化）');
    if (header) {
        try {
            header.click();
            const d2 = content.style.display;
            const m2 = content.style.maxHeight;
            log(`   点完：display=${JSON.stringify(d2)} maxHeight=${JSON.stringify(m2)} 高度=${Math.round(content.getBoundingClientRect().height)}`);
            log('   → 若 Console 出现了 [CMCC] 设置页标题被点击，说明监听器在，能收到点击。');
            log('   → 若高度仍接近 0，说明是 CSS 层的问题（不是监听器）。');
        } catch (e) {
            log('   ❌ 点击抛错: ' + e.message);
        }
    }

    log('');
    log('════ 请把以上全部内容发给我 ════');
    return R.join('\n');
})();
