// UI-only regression checks reuse the fake SillyTavern fixture from the ledger suite.
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const { w, tavern } = boot(10);
    let count = 0, requests = 0;
    const check = (yes, label) => { assert.ok(yes, label); console.log('✓ ' + label); count++; };
    try {
        w.fetch = async () => { requests++; throw Error('UI must not call API'); };
        w.eval('window.ui = { createPanel, createDrawer, ipeArrangeUI, bindAll, ipeSetActiveTab, ipeFoldStates, ipeInstallZoomButtons, ipeZoomOpen, ipeZoomClose };');
        const d = w.document;
        d.body.insertAdjacentHTML('beforeend', '<div id="extensions_settings2"></div>');
        w.jQuery = selector => { const el = d.querySelector(selector); return { length: el ? 1 : 0, append: html => el.insertAdjacentHTML('beforeend', html) }; };
        w.ui.createPanel(); w.ui.createDrawer();
        w.jQuery = undefined;
        const beforeIDs = [...d.querySelectorAll('#ipe-panel [id], #ipe-drawer [id]')].map(el => el.id).sort();
        w.ui.ipeArrangeUI(); w.ui.bindAll(); await delay(200);
        const panel = d.querySelector('#ipe-panel'), drawer = d.querySelector('#ipe-drawer');
        check(JSON.stringify(beforeIDs) === JSON.stringify([...d.querySelectorAll('#ipe-panel [id], #ipe-drawer [id]')].map(el => el.id).sort()), '整理前后所有控件 ID 原样保留');
        check(new Set(beforeIDs).size === beforeIDs.length, '两处入口没有重复控件 ID');
        check(panel.querySelector('.ipe-sections').firstElementChild.id === 'ipe-section-preview', '浮窗预览在生图配置之前');
        for (const prefix of ['ipe', 'iped']) {
            const order = d.querySelector('#' + prefix + '-card-order'), sup = d.querySelector('#' + prefix + '-supplement');
            check(!!order && !!(order.compareDocumentPosition(sup) & w.Node.DOCUMENT_POSITION_FOLLOWING) && !order.closest('details:not([open])'), prefix + ' 本卡长期指令框在补充指令之前、直接可见');
        }
        check(drawer.querySelector('[data-ipe-tab="image"]').firstElementChild.dataset.ipeFold === 'drawer-image-preview', '抽屉预览在生图配置之前');
        // 2.26.0：以前只看名字，名字错一格也照样过——现在看内容：置顶展开的那张卡里真有状态行和预览框，每张卡名字和标题对得上
        const drawerCards = [...drawer.querySelectorAll('[data-ipe-tab="image"] > details')];
        const firstCard = drawerCards[0];
        check(firstCard.open && !!firstCard.querySelector('#iped-status') && !!firstCard.querySelector('#iped-preview-text') && firstCard.querySelector('summary').textContent === '预览', '抽屉置顶展开的就是真正的预览（状态行、预览框都在里面）');
        const wantTitle = { api: 'API 配置', system: '系统提示', template: '画风模板', common: '公共块', anchors: '角色锚点', rules: '提取规则', preview: '预览' };
        check(drawerCards.length === 7 && drawerCards.every(c => wantTitle[c.dataset.ipeFold.replace('drawer-image-', '')] === c.querySelector('summary').textContent), '抽屉七张卡的名字和标题一一对上（' + drawerCards.map(c => c.dataset.ipeFold.replace('drawer-image-', '') + '=' + c.querySelector('summary').textContent).join(' ') + '）');
        // 2.26.2 界面上「基础模板」改叫「画风模板」：两处入口都搜不到旧名字，面板区块标题是新名字
        check(panel.querySelector('#ipe-section-base-template > .ipe-section-header').textContent.includes('画风模板') && !panel.textContent.includes('基础模板') && !drawer.textContent.includes('基础模板'), '「基础模板」改叫「画风模板」：面板标题换了，面板和抽屉里都再看不到旧名字');
        check(drawer.querySelector('.inline-drawer-content').firstElementChild.classList.contains('ipe-tabs'), '抽屉导航置顶');
        for (const key of ['api', 'system', 'template', 'anchors', 'rules']) check(!drawer.querySelector('[data-ipe-fold="drawer-image-' + key + '"]').open, '抽屉 ' + key + ' 默认收起');
        for (const prefix of ['ipe', 'iped']) {
            const auto = d.querySelector('#' + prefix + '-ledger-auto');
            const text = d.querySelector('#' + prefix + '-ledger-text');
            check(!!(auto.compareDocumentPosition(text) & w.Node.DOCUMENT_POSITION_FOLLOWING), prefix + '自动挂账在账本前');
            check(!auto.closest('details'), prefix + '自动挂账无需展开设置');
            const api = d.querySelector('#' + prefix + '-ledger-api').closest('details');
            check(api && !api.open, prefix + '副 AI 配置折叠');
            check(!d.querySelector('#' + prefix + '-ledger-prompt').closest('details').open, prefix + '挂账规则折叠');
            check(!text.closest('details'), prefix + '账本编辑保持直接可见');
        }
        for (const prefix of ['ipe', 'iped']) {
            const el = suffix => d.querySelector('#' + prefix + '-ledger-' + suffix);
            check(!!el('text').closest('.ipe-desk-record') && !!el('save').closest('.ipe-desk-record'), prefix + '账本与保存位于当前账本卡');
            check(!!el('order').closest('.ipe-desk-request') && !!el('extra').closest('.ipe-desk-request'), prefix + '长期指令与一次性补充位于本次挂账卡');
            for (const suffix of ['run', 'preview-box', 'stop', 'force']) check(!!el(suffix).closest('.ipe-desk-request') && !el(suffix).closest('details'), prefix + suffix + '不会被低频折叠隐藏');
            check(!!el('export').closest('.ipe-desk-tools') && !!el('inherit').closest('.ipe-desk-tools') && !!el('age').closest('.ipe-desk-tools'), prefix + '备份继承历史集中收纳');
            check(!!el('api').closest('.ipe-desk-settings') && !!el('prompt').closest('.ipe-desk-settings'), prefix + '规则与连接集中在底部');
            check(!!el('inline').closest('.ipe-desk-display') && !!el('ep-enabled').closest('.ipe-desk-display'), prefix + '显示设置集中收起');
        }
        const header = panel.querySelector('#ipe-section-api-config > .ipe-section-header');
        check(header.tagName === 'BUTTON' && header.type === 'button', '配置标题是可键盘操作的按钮');
        header.click();
        check(header.getAttribute('aria-expanded') === 'true', '展开时辅助状态同步');
        const apiFold = drawer.querySelector('[data-ipe-fold="drawer-image-api"]'); apiFold.open = true;
        await delay(30);
        w.ui.ipeArrangeUI();
        check(apiFold.open && header.getAttribute('aria-expanded') === 'true', '重复整理不覆盖用户开合状态');
        check(w.ui.ipeFoldStates()['drawer-image-api'] === true, '抽屉开合状态已记住');
        const endpoint = d.querySelector('#ipe-api-endpoint');
        endpoint.value = 'https://example.org/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true })); endpoint.dispatchEvent(new w.Event('change', { bubbles: true }));
        await delay(100);
        check(tavern.extensionSettings['image-prompt-extractor'].apiEndpoint === 'https://example.org/v1', '整理后的 API 字段仍正常保存');
        w.ui.ipeSetActiveTab('ledger');
        check(panel.querySelector('#ipe-section-ledger').style.display !== 'none' && drawer.querySelector('[data-ipe-tab="image"]').style.display === 'none', '挂账切页在两处入口正常');
        w.ui.ipeInstallZoomButtons();
        const rule = d.querySelector('#ipe-ledger-prompt');
        check(!!rule.parentElement.querySelector('.ipe-zoom-btn'), '收起的规则仍可放大编辑');
        check(requests === 0, '整理与保存没有发送 API 请求');

        // 2.19.4 拉模型说清楚：新增预设后不挂旧列表；拉取失败清空旧列表、按钮旁报错、弹卡
        w.eval('window.ui.ipeGetApiProfiles = ipeGetApiProfiles; window.ui.ipeGetActiveApiProfileId = ipeGetActiveApiProfileId;');
        const settings = tavern.extensionSettings['image-prompt-extractor'];
        const modelSel = d.querySelector('#ipe-model'), modelSelDrawer = d.querySelector('#iped-model');
        const options = sel => [...sel.options].map(o => o.value);
        const calls = [];
        w.fetch = async (url, opts) => {
            calls.push({ url, auth: (opts && opts.headers && opts.headers.Authorization) || '' });
            if (url.indexOf('broken') >= 0) return { ok: false, status: 404, text: async () => '<html>not found</html>' };
            return { ok: true, status: 200, text: async () => JSON.stringify({ data: url.indexOf('old.example') >= 0 ? [{ id: 'old-a' }, { id: 'old-b' }] : [{ id: 'new-x' }] }) };
        };
        const key = d.querySelector('#ipe-api-key');
        endpoint.value = 'https://old.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        key.value = 'sk-old'; key.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['', 'old-a', 'old-b']), '旧预设拉到列表');
        const oldProfile = w.ui.ipeGetActiveApiProfileId();
        d.querySelector('#ipe-api-profile-add').click(); await delay(30);
        check(w.ui.ipeGetActiveApiProfileId() !== oldProfile, '新增后切到新预设');
        check(settings.model === '' && JSON.stringify(options(modelSel)) === JSON.stringify(['']) && modelSel.options[0].textContent === '请先加载模型', '新增预设不沿用旧模型，下拉只剩「请先加载模型」');
        check(JSON.stringify(options(modelSelDrawer)) === JSON.stringify(['']), '抽屉的下拉同样清空');
        endpoint.value = 'https://broken.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        key.value = 'sk-new'; key.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        const last = calls[calls.length - 1];
        check(last.url === 'https://broken.example/v1/models' && last.auth === 'Bearer sk-new', '请求打到新地址并带新 key');
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['']) && modelSel.options[0].textContent.indexOf('拉取失败') === 0, '拉取失败：下拉不再挂旧列表，占位写明失败');
        const ms = d.querySelector('#ipe-models-status');
        check(ms.style.display !== 'none' && ms.textContent.indexOf('拉取失败') === 0 && ms.textContent.indexOf('404') >= 0, '按钮下方直接写失败原因');
        check(!!ms.closest('#ipe-section-api-config'), '失败原因就在 API 配置区，不用往上翻');
        const cardTitles = [...d.querySelectorAll('#ipe-notice-stack .ipe-notice-title')].map(el => el.textContent);
        const cardBody = [...d.querySelectorAll('#ipe-notice-stack .ipe-notice-body')].map(el => el.textContent).join('\n');
        check(cardTitles.indexOf('小海螺 · 拉取模型失败') >= 0 && cardBody.indexOf('https://broken.example/v1/models') >= 0, '弹了错误卡并写明请求地址');
        endpoint.value = 'https://new.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['', 'new-x']) && settings.model === 'new-x', '换对地址后拉到新列表并选中');
        const profileSel = d.querySelector('#ipe-api-profile');
        profileSel.value = oldProfile; profileSel.dispatchEvent(new w.Event('change', { bubbles: true })); await delay(30);
        check(settings.model === 'old-a' && JSON.stringify(options(modelSel)) === JSON.stringify(['', 'old-a']) && modelSel.value === 'old-a', '切回旧预设：只留它已保存的模型，不显示新预设的列表');

        // 2.19.5/2.19.6 iOS 减负：观察器防乒乓；镜像只在写过时重读；浮标原样保留
        w.eval('window.ui.createChatQuickButton = createChatQuickButton; window.ui.ipeLedgerCommit = ipeLedgerCommit; window.ui.ipeLedgerRenderInline = ipeLedgerRenderInline; window.ui.ipeLedgerInstallInlineObserver = ipeLedgerInstallInlineObserver; window.ui.ipeLedgerSync = ipeLedgerSync; window.ui.ipeLedgerRefreshInherit = ipeLedgerRefreshInherit; window.ui.ipeLedgerSave = ipeLedgerSave; window.ui.ipeLedgerRead = ipeLedgerRead;');
        settings.showQuickEntry = true;
        w.ui.createChatQuickButton();
        const cap = d.querySelector('#ipe-chat-quick-entry');
        check(!!cap && !!cap.querySelector('animate') && String(cap.getAttribute('style') || '').includes('drop-shadow'), '浮标波纹动画与阴影滤镜按作者要求原样保留（2.19.6）');
        // 2.25.1 袖珍浮标：整体减半，SVG 比例不动；小灯必须是整数像素（3.5px 会把胶囊推到半像素位置，右端被裁、小灯被压扁）
        const capCss = fs.readFileSync(__dirname + '/style.css', 'utf8');
        const lampSizes = [...capCss.matchAll(/#ipe-chat-quick-entry\.[\w-]+::(?:before|after)\s*\{[^}]*?width:\s*([\d.]+)px;\s*height:\s*([\d.]+)px/g)].map(m => m[1] + 'x' + m[2]);
        check(cap.style.height === '15px' && cap.style.minHeight === '15px' && cap.querySelector('svg').getAttribute('viewBox') === '0 0 120 44' && String(cap.getAttribute('style')).includes('drop-shadow(0 3px 7px'), '浮标高 15px（原来 30px），投影同比减半，SVG 画布比例原样');
        check(lampSizes.length === 3 && lampSizes.every(s => s === '4x4') && !/0 0 0 9px/.test(capCss) && (capCss.match(/0 0 0 4\.5px/g) || []).length === 8, '三颗小灯都是整数 4px、八套忙碌脉冲外扩都减半到 4.5px（' + lampSizes.join(' ') + '）');
        // 2.19.16 浮标动效开关：关 = 无 <animate>、无 drop-shadow；开 = 恢复；面板 / 抽屉两个勾同步
        w.eval('window.ui.ipeRebuildQuickButton = ipeRebuildQuickButton;');
        const motionCb = d.querySelector('#ipe-quick-motion'), motionCbD = d.querySelector('#iped-quick-motion');
        check(!!motionCb && !!motionCbD && motionCb.checked && motionCbD.checked, '两处入口都有「浮标动效」勾，默认开');
        motionCb.checked = false; motionCb.dispatchEvent(new w.Event('change', { bubbles: true }));
        const capOff = d.querySelector('#ipe-chat-quick-entry');
        check(settings.quickEntryMotion === false && !motionCbD.checked && !!capOff && capOff !== cap && !capOff.querySelector('animate') && !String(capOff.getAttribute('style') || '').includes('drop-shadow') && !!capOff.querySelector('circle'), '关掉动效：浮标重建，无 animate、无 drop-shadow，波纹圈静止保留');
        motionCbD.checked = true; motionCbD.dispatchEvent(new w.Event('change', { bubbles: true }));
        const capOn = d.querySelector('#ipe-chat-quick-entry');
        check(settings.quickEntryMotion === true && motionCb.checked && !!capOn && !!capOn.querySelector('animate') && String(capOn.getAttribute('style') || '').includes('drop-shadow'), '再打开：animate 与 drop-shadow 都回来');
        // 楼内展示：装一个「看到就抹掉」的敌对观察器，模拟别的扩展整楼重画
        d.body.insertAdjacentHTML('beforeend', '<div id="chat">' + tavern.chat.map((m, i) => '<div class="mes" mesid="' + i + '"' + (m.is_user ? ' is_user="true"' : '') + '><div class="mes_text">第 ' + (i + 1) + ' 楼</div></div>').join('') + '</div>');
        w.ui.ipeLedgerCommit('账本正文，够长够长够长够长够长够长够长够长。', tavern.chat.length);

        // 2.19.17 生成期间撤哨：GENERATION_STARTED 断开 #chat 观察器，结束事件接回并补查；dryRun 不撤；超时自动接回
        w.ui.ipeLedgerInstallInlineObserver(); w.ui.ipeLedgerRenderInline();
        const blockNow = () => d.querySelector('#chat .ipe-ledger-inline');
        check(!!blockNow(), '楼内账本块已渲染');
        await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, true);
        blockNow().remove(); await delay(450);
        check(!!blockNow(), 'dryRun 的 GENERATION_STARTED 不撤哨：块被抹掉 250ms 内补回');
        await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        blockNow().remove(); await delay(450);
        check(!blockNow() && w.eval('ipeChatObsPaused') === true, '生成开始撤哨：流式期间块被抹掉不补，观察器不再收变动');
        await tavern.eventSource.emit('GENERATION_ENDED');
        check(!!blockNow() && w.eval('ipeChatObsPaused') === false, '生成结束接回哨兵并补查：账本块立刻补回');
        blockNow().remove(); await delay(450);
        check(!!blockNow(), '接回之后观察器照常工作：再抹掉还是会补');
        w.eval('IPE_CHAT_OBS_PAUSE_MAX_MS = 300;');
        await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        blockNow().remove(); await delay(150);
        check(!blockNow(), '撤哨中（保险还没到点）');
        await delay(400);
        check(!!blockNow() && w.eval('ipeChatObsPaused') === false, '没等到结束事件也不怕：撤哨超时自动接回并补查');
        w.eval('IPE_CHAT_OBS_PAUSE_MAX_MS = 5 * 60 * 1000;');
        blockNow().remove();   // 下面的敌对观察器用例要从「块不在」开始，才看得到补块
        let wiped = 0;
        const hostile = new w.MutationObserver(recs => { recs.forEach(r => r.addedNodes.forEach(n => { if (n.classList && n.classList.contains('ipe-ledger-inline')) { wiped++; n.remove(); } })); });
        hostile.observe(d.querySelector('#chat'), { childList: true, subtree: true });
        w.ui.ipeLedgerInstallInlineObserver();
        w.ui.ipeLedgerRenderInline();
        await delay(3200);
        const wipedAt3s = wiped;
        check(wipedAt3s >= 2 && wipedAt3s <= 8, '楼内块被反复抹掉时补块有上限（3 秒内 ' + wipedAt3s + ' 次），不会无限乒乓');
        await delay(1200);
        check(wiped === wipedAt3s, '进入冷却后不再跟着别人的变动补块');
        w.ui.ipeLedgerSync(); await delay(30);
        check(wiped === wipedAt3s + 1, '冷却期间自己的落账 / 同步照常重绘楼内块');
        hostile.disconnect();
        // 继承列表：镜像只解析一次留在内存里；落账只标脏，空闲时才写 localStorage（2.19.15）
        w.eval('window.ui.LSK = IPE_LEDGER_LS_KEY; window.ui.ipeLedgerMirrorFlush = ipeLedgerMirrorFlush;');
        let lsReads = 0, lsWrites = 0;
        const rawGet = w.Storage.prototype.getItem, rawSet = w.Storage.prototype.setItem;   // jsdom 的 Storage 实例上赋值会变成存一个键，得改原型
        w.Storage.prototype.getItem = function(k){ if (k === w.ui.LSK) lsReads++; return rawGet.call(this, k); };
        w.Storage.prototype.setItem = function(k, v){ if (k === w.ui.LSK) lsWrites++; return rawSet.call(this, k, v); };
        w.ui.ipeLedgerRefreshInherit(); w.ui.ipeLedgerRefreshInherit(); w.ui.ipeLedgerRefreshInherit();
        const readsBefore = lsReads;
        w.ui.ipeLedgerSave(w.ui.ipeLedgerRead());
        const writesRightAfterSave = lsWrites;
        w.ui.ipeLedgerRefreshInherit();
        check(readsBefore <= 1 && lsReads === readsBefore, '「继承账本」列表与落账都走内存里的镜像副本，不再反复解析 localStorage（共读 ' + lsReads + ' 次）');
        check(writesRightAfterSave === 0, '落账当下不写 localStorage（镜像写盘挪到空闲时）');
        await delay(400);
        check(lsWrites === 1, '空闲后镜像落盘一次（' + lsWrites + ' 次）');
        w.ui.ipeLedgerSave(w.ui.ipeLedgerRead()); w.ui.ipeLedgerSave(w.ui.ipeLedgerRead());
        check(w.ui.ipeLedgerMirrorFlush() === true && lsWrites === 2, '连着落两次账只写一次盘，手动 flush 立刻落（' + lsWrites + ' 次）');
        w.Storage.prototype.getItem = rawGet; w.Storage.prototype.setItem = rawSet;
        check(!!d.querySelector('#ipe-ledger-size'), '字数估算灰字仍然存在（改为空闲时算）');

        // 2.19.12 粉蓝海滩：配色按钮五档循环，海滩叠在浅色皮上
        w.eval('window.ui.ipeApplyTheme = ipeApplyTheme;');
        settings.mistTheme = false; settings.apricotTheme = false; settings.jadeTheme = false; settings.beachTheme = false; settings.pearlTheme = false; settings.lemonTheme = false; w.ui.ipeApplyTheme();
        const tt = d.querySelector('#ipe-theme-toggle');
        const modeOf = () => ['lemon','pearl','beach','jade','apricot','mist'].find(k => panel.classList.contains('ipe-' + k)) || 'night';
        const seq = [modeOf() + tt.textContent];
        for (let i = 0; i < 7; i++) { tt.click(); seq.push(modeOf() + tt.textContent); }
        check(seq.join(' ') === 'night🌙 mist☀️ apricot🌅 jade🌊 beach🏝️ pearl🐚 lemon🍋 night🌙', '配色七档循环：月潮 → 海雾 → 杏岸 → 碧岸 → 粉蓝海滩 → 珠光海螺 → 柠檬海滩 → 月潮（' + seq.join(' ') + '）');
        for (let i = 0; i < 4; i++) tt.click();
        check(settings.mistTheme === true && settings.beachTheme === true && settings.jadeTheme === false && settings.apricotTheme === false && panel.classList.contains('ipe-mist') && panel.classList.contains('ipe-beach') && !panel.classList.contains('ipe-jade'), '粉蓝海滩 = 浅色皮 + ipe-beach，杏岸 / 碧岸标记都清掉');
        check(fs.readFileSync(__dirname + '/style.css', 'utf8').includes('html body.ipe-skin-beach:not(#_) #ipe-chat-quick-entry svg stop:first-child'), '浮标有海滩配色规则');

        // 2.19.13 珠光海螺：第六档，灰蓝莫兰迪渐到珍珠白，浮标同步
        tt.click();
        check(settings.mistTheme === true && settings.pearlTheme === true && settings.beachTheme === false && settings.jadeTheme === false && settings.apricotTheme === false && panel.classList.contains('ipe-mist') && panel.classList.contains('ipe-pearl') && !panel.classList.contains('ipe-beach'), '珠光海螺 = 浅色皮 + ipe-pearl，粉蓝海滩标记清掉');
        const css = fs.readFileSync(__dirname + '/style.css', 'utf8');
        check(css.includes('html body.ipe-skin-pearl:not(#_) #ipe-chat-quick-entry svg stop:first-child') && css.includes('ipe-cap-pulse-pearl') && css.includes('ipe-cap-ledger-pulse-pearl'), '浮标有珠光海螺配色规则（渐变与忙碌脉冲）');
        // 2.19.14 柠檬海滩：第七档，柠檬黄、长春花蓝与樱花粉，浮标同步
        tt.click();
        check(settings.mistTheme === true && settings.lemonTheme === true && settings.pearlTheme === false && settings.beachTheme === false && panel.classList.contains('ipe-mist') && panel.classList.contains('ipe-lemon') && !panel.classList.contains('ipe-pearl'), '柠檬海滩 = 浅色皮 + ipe-lemon，珠光海螺标记清掉');
        check(css.includes('html body.ipe-skin-lemon:not(#_) #ipe-chat-quick-entry svg stop:first-child') && css.includes('ipe-cap-pulse-lemon') && css.includes('ipe-cap-ledger-pulse-lemon'), '浮标有柠檬海滩配色规则（渐变与忙碌脉冲）');
        check(d.body.classList.contains('ipe-skin-mist') && d.body.classList.contains('ipe-skin-lemon') && !d.body.classList.contains('ipe-skin-pearl') && !css.includes('body:has(#ipe-panel'), '2.19.15 配色写在 body 的 ipe-skin-* 类上，CSS 不再用 body:has()');
        tt.click();
        check(settings.mistTheme === false && settings.lemonTheme === false && settings.pearlTheme === false && !panel.classList.contains('ipe-lemon') && !panel.classList.contains('ipe-mist'), '柠檬海滩再点一下回到月潮');
        check(!d.body.classList.contains('ipe-skin-mist') && !d.body.classList.contains('ipe-skin-lemon'), '月潮：body 上没有任何 ipe-skin-* 类');

        // 2.19.15 预设下拉按拼音排序（显示顺序），存储顺序与选中项不动
        w.eval('window.ui.ipeRefreshTemplateEditors = ipeRefreshTemplateEditors; window.ui.ipeGetBaseTemplates = ipeGetBaseTemplates; window.ui.ipeRefreshAnchorEditors = ipeRefreshAnchorEditors;');
        settings.baseTemplatesJson = JSON.stringify([
            { id: 'tpl_a', name: '月潮', value: 'a' }, { id: 'tpl_b', name: '杏岸', value: 'b' }, { id: 'tpl_c', name: '预设10', value: 'c' },
            { id: 'tpl_d', name: '海雾', value: 'd' }, { id: 'tpl_e', name: '预设2', value: 'e' }]);
        settings.activeBaseTemplate = 'tpl_b';
        w.ui.ipeRefreshTemplateEditors();
        const optNames = [...d.querySelector('#ipe-template-slot').options].map(o => o.textContent);
        const pos = n => optNames.indexOf(n);
        check(pos('海雾') < pos('杏岸') && pos('杏岸') < pos('月潮') && pos('预设2') < pos('预设10'), '模板下拉按拼音排：海雾 → 杏岸 → 月潮，预设2 在 预设10 前（' + optNames.join(' ') + '）');
        check(d.querySelector('#ipe-template-slot').value === 'tpl_b' && d.querySelector('#iped-reinject-tpl').value === 'tpl_b', '排序后当前选中的模板不变');
        check(w.ui.ipeGetBaseTemplates().map(x => x.name).join(' ') === '月潮 杏岸 预设10 海雾 预设2', '存储顺序仍是先后顺序，只有下拉显示在排');
        settings.anchorPresetsJson = JSON.stringify([{ id: 'anchor_1', name: '张三', value: '' }, { id: 'anchor_2', name: '阿宝', value: '' }, { id: 'anchor_3', name: 'Lina', value: '' }]);
        w.ui.ipeRefreshAnchorEditors();
        const ancNames = [...d.querySelector('#ipe-anchor-slot').options].map(o => o.textContent);
        check(ancNames.indexOf('阿宝') < ancNames.indexOf('张三'), '锚点下拉同样按拼音排（' + ancNames.join(' ') + '）');

        // 2.27.7 正文标签：浮窗、抽屉的生图页和挂账页各一格，是同一个设置；改一格四格跟着变，清空也存得住
        w.eval('window.ui.ipeBodyTagBindUI = ipeBodyTagBindUI;');
        w.ui.ipeBodyTagBindUI();
        const btIds = ['ipe-body-tag', 'iped-body-tag', 'ipe-ledger-body-tag', 'iped-ledger-body-tag'];
        const bt = id => d.querySelector('#' + id);
        check(btIds.every(id => bt(id) && bt(id).value === 'content'), '正文标签四格都在（浮窗 / 抽屉 × 生图 / 挂账），默认都显示 content');
        check(!!bt('ipe-body-tag').closest('#ipe-section-extract-rules') && !!bt('iped-body-tag').closest('[data-ipe-fold="drawer-image-rules"]'), '生图那格在「提取规则」里');
        check(['ipe-ledger-body-tag', 'iped-ledger-body-tag'].every(id => { const f = bt(id).closest('details'); return f && f.querySelector('summary').textContent.includes('高级设置') && !!bt(id).closest('.ipe-desk-settings'); }), '挂账那格在副 AI 的「高级设置」里');
        bt('ipe-body-tag').value = '<正文>， main';
        bt('ipe-body-tag').dispatchEvent(new w.Event('change'));
        check(settings.bodyTag === '正文, main' && btIds.every(id => bt(id).value === '正文, main'), '改生图那格：存成「正文, main」（带尖括号、全角逗号都认），四格一起变');
        check(d.querySelector('#ipe-status').textContent.includes('<正文> / <main>') && d.querySelector('#iped-status').textContent.includes('<正文> / <main>'), '生图状态行说正文标签改成了什么');
        bt('iped-ledger-body-tag').value = '';
        bt('iped-ledger-body-tag').dispatchEvent(new w.Event('change'));
        check(settings.bodyTag === '' && btIds.every(id => bt(id).value === ''), '清空挂账那格：存成空（不会被默认值顶回 content），四格一起空');
        check(d.querySelector('#ipe-ledger-status').textContent.includes('清空') && d.querySelector('#ipe-ledger-status').textContent.includes('只拦空回'), '挂账状态行说清空了：照老样子认 <content>，只拦空回');
        bt('ipe-ledger-body-tag').value = '</content>';
        bt('ipe-ledger-body-tag').dispatchEvent(new w.Event('change'));
        check(settings.bodyTag === 'content' && btIds.every(id => bt(id).value === 'content'), '填成 </content> 也认得：改回 content');
        // 2.27.8 开场白开关：浮窗预览区、抽屉顶上各一个，都在「自动注入」下面；默认开着，改一个两个一起变
        w.eval('window.ui.ipeGreetingBindUI = ipeGreetingBindUI;');
        w.ui.ipeGreetingBindUI();
        const gp = d.querySelector('#ipe-auto-greeting'), gd = d.querySelector('#iped-auto-greeting');
        check(gp && gd && gp.checked && gd.checked, '开场白开关浮窗、抽屉各一个，默认开着');
        check(gp.closest('label').parentElement.previousElementSibling.querySelector('#ipe-auto-inject') && gd.closest('label').parentElement.previousElementSibling.querySelector('#iped-auto-inject'), '两个开关都紧挨在「自动注入」下面');
        gp.checked = false; gp.dispatchEvent(new w.Event('change'));
        check(settings.imgAutoGreeting === false && !gd.checked && d.querySelector('#ipe-status').textContent.includes('开场白不自动出图'), '关掉浮窗那个：存下来，抽屉那个跟着关，状态行说开场白不自动出图了');
        gd.checked = true; gd.dispatchEvent(new w.Event('change'));
        check(settings.imgAutoGreeting === true && gp.checked, '打开抽屉那个：浮窗那个跟着开');
        console.log('通过 ' + count + ' 项');
    } finally { w.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
