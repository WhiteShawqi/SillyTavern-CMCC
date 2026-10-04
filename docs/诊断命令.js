// CMCC 诊断 —— 把这整段复制到 ST 页面的 F12 Console 里回车
// 它只读取状态、不改任何东西
(() => {
    const q = (s) => document.querySelector(s);
    const host = q('#top-settings-holder');
    const drawer = q('#cmcc-top-drawer');
    const panel = q('#cmcc-top-panel');
    const body = q('#cmcc-top-panel_body');
    const st = drawer ? getComputedStyle(drawer) : null;
    const ps = panel ? getComputedStyle(panel) : null;

    const info = {
        '1_图标栏存在': !!host,
        '2_图标栏子元素数': host ? host.children.length : -1,
        '3_各抽屉宽度': host
            ? [...host.children].map((d) => Math.round(d.getBoundingClientRect().width))
            : [],
        '4_CMCC抽屉存在': !!drawer,
        '4a_CMCC抽屉flex': st ? st.flex : null,
        '4b_CMCC抽屉宽度': drawer ? Math.round(drawer.getBoundingClientRect().width) : -1,
        '5_CMCC面板存在': !!panel,
        '5a_面板class': panel ? panel.className : null,
        '5b_面板宽高': panel
            ? [Math.round(panel.getBoundingClientRect().width),
               Math.round(panel.getBoundingClientRect().height)]
            : null,
        '5c_面板display': ps ? ps.display : null,
        '5d_面板position': ps ? ps.position : null,
        '5e_面板height': ps ? ps.height : null,
        '6_body存在': !!body,
        '6a_body子元素数': body ? body.children.length : -1,
        '6b_body高度': body ? Math.round(body.getBoundingClientRect().height) : -1,
        '6c_body文本前100字': body ? (body.textContent || '').trim().slice(0, 100) : null,
        '7_设置面板存在': !!q('#cmcc_settings'),
        '8_扩展设置容器': {
            extensions_settings: !!q('#extensions_settings'),
            extensions_settings2: !!q('#extensions_settings2'),
        },
    };

    console.log('===== CMCC 诊断 =====');
    console.table
        ? console.table(info)
        : Object.entries(info).forEach(([k, v]) => console.log(k, '=', v));
    console.log(JSON.stringify(info, null, 2));
    console.log('===== 把上面这段 JSON 发给我 =====');
    return info;
})();
