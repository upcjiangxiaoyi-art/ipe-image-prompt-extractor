// 顺滑回归（2.25.0）：🐚 块挂在 .mes_text 外、被抹掉当场补、新楼同帧挪、改动前后钉住视线、换画风原地换。
// 2.26.3：美化把楼里的块重新排座（flex + order / grid 格子）时 🐚 仍在正文底下。
// jsdom 不排版：这里自己按「楼头 100 + .mes_text 里每个元素 60 + 🐚 块 40」算盒子，#chat 视口 600 高，
// scrollTop 越界会被夹住；不带滚动锚定，等于 iOS Safari（最容易跳的那种）。
// 楼里各块按 flex 排（读主题样式算出来的 order），也能换成模仿 grid 美化的摆法。
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(r => setTimeout(r, ms));
const microtasks = () => new Promise(r => Promise.resolve().then(() => Promise.resolve()).then(r));   // 观察器回调已跑完，没等任何定时器
const watchdog = setTimeout(() => { console.error('test timed out'); process.exit(1); }, 20000);
let count = 0;
const check = (yes, label, extra) => { assert.ok(yes, label + (extra ? '：' + extra : '')); console.log('✓ ' + label); count++; };

const VIEW = 600;
function rowHtml(i, m, paras) {
    return '<div class="mes" mesid="' + i + '" is_user="' + !!(m && m.is_user) + '"><div class="mes_block">'
        + '<div class="ch_name"><div class="mes_buttons"><div class="extraMesButtonsHint"></div></div></div>'
        + '<div class="mes_text">' + (paras || ['<p>第 ' + (i + 1) + ' 楼正文第一段。</p>', '<p>第二段。</p>', '<p>第三段。</p>']).join('') + '</div>'
        + '</div></div>';
}
function setup(floors, opts) {
    opts = opts || {};
    const { w, tavern, F } = boot(floors);
    const d = w.document;
    if (opts.css) d.head.insertAdjacentHTML('beforeend', '<style>' + opts.css + '</style>');   // 美化主题的样式
    d.body.insertAdjacentHTML('beforeend', '<div id="chat">' + tavern.chat.map((m, i) => rowHtml(i, m)).join('') + '</div>');
    const chat = d.querySelector('#chat');
    const rows = () => Array.from(chat.querySelectorAll(':scope > .mes'));
    const isShell = el => el.classList.contains('ipe-ledger-inline');
    // 楼里每块多高：楼头 100（窄屏操作栏多一颗按钮挤成两行再 +20）、正文里每段 60、🐚 40（挂在正文外、住在正文里都一样）
    const partHeight = el => isShell(el) ? 40
        : el.classList.contains('ch_name') ? 100 + (opts.headerWrap && el.querySelectorAll('.mes_buttons > *').length >= 2 ? 20 : 0)
        : el.classList.contains('mes_text') ? Array.from(el.children).reduce((s, c) => s + partHeight(c), 0)
        : 60;
    const height = row => row.style.display === 'none' ? 0
        : Array.from(row.querySelector('.mes_block').children).reduce((s, c) => s + partHeight(c), 0);
    const total = () => rows().reduce((s, r) => s + height(r), 0);
    /* 楼里各块排在哪：默认按 flex 排（order 小的在前、一样的按 DOM 先后；没有美化样式时就是 DOM 顺序）。
       layout: 'grid-hole' 模仿 grid 美化：名字、正文各占一个命名格子，没格子的 🐚 自动落进名字和正文之间空着的那格（思维链那格没东西），order 管不着 */
    const place = row => {
        const kids = Array.from(row.querySelector('.mes_block').children);
        let seq;
        if (opts.layout === 'grid-hole') {
            seq = kids.filter(k => !isShell(k));
            const shell = kids.find(isShell);
            if (shell) seq.splice(seq.findIndex(k => k.classList.contains('mes_text')), 0, shell);
        } else {
            const ord = el => Number(w.getComputedStyle(el).order) || 0;
            seq = kids.map((k, i) => [k, i]).sort((a, b) => ord(a[0]) - ord(b[0]) || a[1] - b[1]).map(x => x[0]);
        }
        const pos = new Map();
        let y = 0;
        for (const k of seq) {
            pos.set(k, [y, partHeight(k)]);
            if (k.classList.contains('mes_text')) {
                let ty = y;
                for (const c of k.children) { pos.set(c, [ty, partHeight(c)]); ty += partHeight(c); }
            }
            y += partHeight(k);
        }
        return pos;
    };
    let top = 0;
    const clamp = v => Math.max(0, Math.min(v, Math.max(0, total() - VIEW)));
    Object.defineProperty(chat, 'scrollTop', { configurable: true, get: () => top, set: v => { top = clamp(Number(v) || 0); } });
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, get: total });
    Object.defineProperty(chat, 'clientHeight', { configurable: true, get: () => VIEW });
    const box = (y, h) => ({ top: y, bottom: y + h, height: h, left: 0, right: 400, width: 400, x: 0, y: y });
    const proto = w.HTMLElement.prototype, orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
        if (this === chat) return box(0, VIEW);
        if (this.parentNode === chat && this.classList.contains('mes')) {
            let y = 0;
            for (const r of rows()) { if (r === this) break; y += height(r); }
            return box(y - top, height(this));
        }
        const row = this.closest && this.closest('#chat > .mes');
        if (row && row.style.display !== 'none') {                    // 楼里的块：楼的位置 + 在楼里排到哪
            const p = place(row).get(this);
            if (p) return box(row.getBoundingClientRect().top + p[0], p[1]);
        }
        return orig.call(this);
    };
    const row = i => chat.querySelector('.mes[mesid="' + i + '"]');
    const rowTop = i => row(i).getBoundingClientRect().top;
    const inline = () => chat.querySelectorAll('.ipe-ledger-inline');
    const st = tavern.extensionSettings[F('EXT_NAME')];
    tavern.saveChat = () => {};
    st.enabled = false; st.ledgerAutoRun = false;   // 只测楼内显示，不让自动提取 / 自动挂账插进来
    return { w, tavern, F, d, chat, row, rowTop, inline, st, height };
}
// 酒馆开新一轮：user 楼 + 流式 AI 楼（撤哨期间画出来）
function addTurn(env, text, paras) {
    const { tavern, chat } = env;
    const u = tavern.chat.length;
    tavern.chat.push({ is_user: true, is_system: false, mes: '我说了一句话。' });
    tavern.chat.push({ is_user: false, is_system: false, mes: text || '新的一楼正文。' });
    chat.insertAdjacentHTML('beforeend', rowHtml(u, tavern.chat[u], ['<p>我说了一句话。</p>']) + rowHtml(u + 1, tavern.chat[u + 1], paras));
    return u + 1;
}

(async () => {
    // ── 1. 🐚 块挂在 .mes_text 后面；新楼到了同一轮挪过去，上一楼摘块不让眼前的字上窜 ──
    {
        const env = setup(12);
        const { w, tavern, F, row, rowTop, inline, chat, height } = env;
        try {
            w.eval('ipeLedgerInstallInlineObserver()');
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerRenderInline()');
            const blk = row(11).querySelector('.ipe-ledger-inline');
            check(!!blk && inline().length === 1, '账本块挂在最后一条 AI 楼');
            check(!blk.closest('.mes_text') && blk.previousElementSibling === row(11).querySelector('.mes_text'), '块是 .mes_text 的下一个兄弟，不在正文里面');
            check(!blk.getAttribute('style') && w.eval('ipeLedgerInlineInside') === false, '没重排楼内块的美化：量过也不加任何行内样式，和 2.25.0 一样挂在正文外');
            check(fs.readFileSync(__dirname + '/style.css', 'utf8').includes('.ipe-ledger-inline{margin:5px var(--mes-right-spacing,0px) 5px 0'), '样式补回原来 .mes_text 的右侧留白与上下间距');

            await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);     // 撤哨
            const last = addTurn(env, '新的一楼正文，流式画出来了。', Array.from({ length: 10 }, (_, i) => '<p>新楼第 ' + (i + 1) + ' 段。</p>'));
            chat.scrollTop = 10000;
            chat.scrollTop = chat.scrollTop - 150;                                       // 人往上翻了一点在读新楼
            const topBefore = rowTop(last), scrollBefore = chat.scrollTop, h11 = height(row(11));
            check(topBefore > 0 && topBefore < VIEW && rowTop(11) + height(row(11)) < 0, '前提：新楼在视口里，上一楼（带块）整个在视口上面');
            await tavern.eventSource.emit('MESSAGE_RECEIVED', last, 'normal');
            check(!!row(last).querySelector('.mes_block > .ipe-ledger-inline') && inline().length === 1, 'MESSAGE_RECEIVED 当场挪到新楼，不等 500ms 后的同步');
            check(height(row(11)) === h11 - 40, '上一楼少了块的 40px（没补的话眼前的字会上窜 40px）');
            check(rowTop(last) === topBefore, '正在读的新楼纹丝不动（' + topBefore + ' → ' + rowTop(last) + '）');
            check(chat.scrollTop === scrollBefore - 40, 'scrollTop 往回补了正好 40');
            await delay(560);
            check(rowTop(last) === topBefore && inline().length === 1, '500ms 后的同步不再动它');
        } finally { w.close(); }
    }

    // ── 2. 正文被整块重写碰不到块；整楼换掉当场补（不再空 250ms）；非流式先发事件后画楼也一次挪好 ──
    {
        const env = setup(12);
        const { w, tavern, F, row, inline, chat } = env;
        try {
            w.eval('ipeLedgerInstallInlineObserver(); window.__ri = 0; var __oldRI = ipeLedgerRenderInline; ipeLedgerRenderInline = function(o){ window.__ri++; return __oldRI(o); };');
            F('ipeLedgerCommit')('账本正文，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerSync()');
            const blk = row(11).querySelector('.ipe-ledger-inline'); blk.open = true;
            w.__ri = 0;
            for (let i = 0; i < 5; i++) row(11).querySelector('.mes_text').innerHTML = '<p>酒馆 / 前端卡 / 变量框架重写正文 ' + i + '</p>';
            await microtasks();
            check(row(11).querySelector('.ipe-ledger-inline') === blk && blk.open, '.mes_text 被 innerHTML 重写 5 次：块还是那个节点、展开状态还在');
            check(w.__ri === 0, '正文重写不触发任何补块（以前每次都抹掉 → 250ms 后补）');

            const fresh = row(11).cloneNode(false);                       // 整楼换成新节点（redisplayChat 那种）
            fresh.innerHTML = rowHtml(11, tavern.chat[11]).replace(/^<div[^>]*>|<\/div>$/g, '');
            row(11).replaceWith(fresh);
            await microtasks();
            check(!!fresh.querySelector('.mes_block > .ipe-ledger-inline') && inline().length === 1, '整楼被换掉：观察器回调里当场补回，浏览器画下一帧之前块就在');

            // 非流式：MESSAGE_RECEIVED 在画楼之前
            tavern.chat.push({ is_user: true, is_system: false, mes: 'u' }, { is_user: false, is_system: false, mes: '非流式新楼。' });
            await tavern.eventSource.emit('MESSAGE_RECEIVED', 13, 'normal');
            check(!!row(11).querySelector('.ipe-ledger-inline'), '新楼还没画：旧块先留着，不摘成空的');
            chat.insertAdjacentHTML('beforeend', rowHtml(12, tavern.chat[12], ['<p>u</p>']) + rowHtml(13, tavern.chat[13]));
            await microtasks();
            check(!!row(13).querySelector('.mes_block > .ipe-ledger-inline') && inline().length === 1, '新楼一画出来，同一轮就挪过去');
        } finally { w.close(); }
    }

    // ── 3. 重 roll：块留在楼尾当页脚，字当场换成对账后的那份 ──
    {
        const env = setup(12);
        const { w, tavern, F, row, inline } = env;
        try {
            w.eval('ipeLedgerInstallInlineObserver()');
            F('ipeLedgerCommit')('第 10 楼的旧账，够长够长够长够长够长。', 10);
            F('ipeLedgerCommit')('第 12 楼的新账，这楼 roll 掉就作废。', 12);
            w.eval('ipeLedgerSync()');
            const blk = row(11).querySelector('.ipe-ledger-inline');
            await tavern.eventSource.emit('GENERATION_STARTED', 'swipe', {}, false);
            check(row(11).querySelector('.ipe-ledger-inline') === blk && blk.textContent.includes('第 10 楼的旧账') && !blk.textContent.includes('作废'), '按下重 roll：同一个块，字已换成对账后的那份');
            for (let i = 0; i < 8; i++) row(11).querySelector('.mes_text').innerHTML = '<p>流式第 ' + i + ' 帧</p>';
            check(row(11).querySelector('.ipe-ledger-inline') === blk, '流式期间正文一帧帧重写，块一直在（以前第一帧就被抹掉，结束才冒出来）');
            await tavern.eventSource.emit('MESSAGE_RECEIVED', 11, 'swipe');
            check(row(11).querySelector('.ipe-ledger-inline') === blk && inline().length === 1, '生成结束：还是那个块，不重建');
        } finally { w.close(); }
    }

    // ── 4. 绘画注入：原文一字不改、落在正文末尾（🐚 之前）；注入在视口上面的楼时钉住视线 ──
    {
        const env = setup(14);
        const { w, tavern, F, row, rowTop, chat, st } = env;
        try {
            st.baseTemplatesJson = JSON.stringify([{ id: 'tpl_a', name: '水墨', value: '<draw>INK: {Description}</draw>' }]);
            st.activeBaseTemplate = 'tpl_a';
            F('ipeLedgerCommit')('账本正文，够长够长够长够长够长。', 14);
            w.eval('ipeLedgerSync()');
            chat.scrollTop = 10000; chat.scrollTop = chat.scrollTop - 100;
            const before13 = rowTop(13);
            const r = F('injectDescToMessage')('a girl by the sea', 13);
            const mt = row(13).querySelector('.mes_text');
            const p = mt.lastElementChild;
            check(r.injected && tavern.chat[13].mes.endsWith('\n\n<draw>INK: a girl by the sea</draw>'), '注入进 mes 的内容和以前一样');
            check(p.tagName === 'P' && p.classList.contains('ipe-draw-inline') && p.textContent === '<draw>INK: a girl by the sea</draw>', '楼里贴的还是那串原文，只多个类名');
            check(mt.nextElementSibling && mt.nextElementSibling.classList.contains('ipe-ledger-inline'), '顺序：正文 → 生图段 → 🐚，和酒馆重画后一样');
            check(rowTop(13) === before13, '注入在正在读的楼尾：眼前的字不动');
            F('injectDescToMessage')('a girl by the sea', 13);
            check(mt.querySelectorAll('.ipe-draw-inline').length === 1, '重复注入不重复贴');

            const top13 = rowTop(13), s0 = chat.scrollTop;
            check(row(9).getBoundingClientRect().bottom < 0, '前提：第 10 楼整个在视口上面');
            F('injectDescToMessage')('an old floor picture', 9);
            check(!!row(9).querySelector('.mes_text > .ipe-draw-inline'), '往视口上面的楼注入');
            check(rowTop(13) === top13 && chat.scrollTop === s0 + 60, '上面长了 60px，scrollTop 跟着补 60，眼前的字不被往下推');
            check(fs.readFileSync(__dirname + '/style.css', 'utf8').includes('.mes_text > p.ipe-draw-inline{white-space:pre-line'), '生图段换行照原样分行（和酒馆重画后的 <br> 一样高）');
        } finally { w.close(); }
    }

    // ── 5. 换画风：原地换；楼被酒馆重画过也认得旧段，不再叠一段；认不准不乱摘 ──
    {
        const env = setup(12);
        const { w, tavern, F, row, st } = env;
        try {
            st.baseTemplatesJson = JSON.stringify([
                { id: 'tpl_a', name: '水墨', value: '<draw>\nINK style\n{Description}\n</draw>' },
                { id: 'tpl_b', name: '动漫', value: '<draw>ANIME: {Description}</draw>' }]);
            st.activeBaseTemplate = 'tpl_a';
            const m = tavern.chat[11];
            m.mes = '第 12 楼正文。';
            const mt = row(11).querySelector('.mes_text');
            mt.innerHTML = '<p>第 12 楼正文。</p>';
            F('injectDescToMessage')('a *quiet* "harbor" at dusk', 11);
            // 刷新后酒馆重画这楼：<draw> 被净化掉，换行成了 <br>，*…* 成了 <em>，引号包成 <q>
            mt.innerHTML = '<p>第 12 楼正文。</p><p><br>INK style<br>a <em>quiet</em> <q>"harbor"</q> at dusk<br></p>';
            const story = mt.firstElementChild;
            st.activeBaseTemplate = 'tpl_b';
            const r = F('reinjectDescToMessage')(11, { preferRecord: true });
            check(r.injected && m.mes === '第 12 楼正文。\n\n<draw>ANIME: a *quiet* "harbor" at dusk</draw>', 'mes 里旧块剥掉、按新模板重拼（和以前一样）');
            check(mt.children.length === 2 && mt.firstElementChild === story, '酒馆重画过的旧段被认出来换掉，正文那段原封不动');
            check(mt.lastElementChild.classList.contains('ipe-draw-inline') && mt.lastElementChild.textContent === '<draw>ANIME: a *quiet* "harbor" at dusk</draw>', '新段落在旧段原来的位置，只有一段');

            // 认不准就不摘：楼尾是前端卡 / 图，或者正文最后一段和旧块对不上
            mt.innerHTML = '<p>第 12 楼正文。</p><p>ANIME: a quiet harbor at dusk</p><div class="card"><iframe></iframe></div>';
            st.activeBaseTemplate = 'tpl_a';
            F('reinjectDescToMessage')(11, { preferRecord: true });
            check(!!mt.querySelector('.card iframe') && mt.children[1].textContent === 'ANIME: a quiet harbor at dusk', '楼尾是前端卡：一个都不摘，前端卡原样');
            check(mt.lastElementChild.classList.contains('ipe-draw-inline'), '认不准时照老样子追加新段');
            m.mes = '第 12 楼正文。\n\n<draw>ANIME: something else entirely</draw>';
            m.extra.ipe_inject_env = 'draw';
            mt.innerHTML = '<p>第 12 楼正文。</p><p>Totally unrelated closing line.</p>';
            st.activeBaseTemplate = 'tpl_b';
            F('reinjectDescToMessage')(11, { preferRecord: true });
            check(mt.children.length === 3 && mt.children[1].textContent === 'Totally unrelated closing line.', '正文最后一段和旧块对不上：不当成旧块摘掉');
        } finally { w.close(); }
    }

    // ── 6. 锚点工具：挑对锚点、跳过藏起来的楼、原生滚动锚定已补过就不补第二遍、平滑滚动也瞬间补 ──
    {
        const env = setup(12);
        const { w, row, chat } = env;
        try {
            const anchorOf = () => w.eval('ipeChatViewAnchor')(chat);
            chat.scrollTop = 280;                                         // 第 0 楼（280 高）刚好整个滚出去
            check(anchorOf() === row(1), '视口里第一条在视口内开头的楼当锚点');
            chat.scrollTop = 100;
            check(anchorOf() === row(1), '第 0 楼头在视口上面：用下一条在视口里开头的楼');
            row(1).style.display = 'none';
            check(anchorOf() === row(2), '藏起来的楼（没盒子）跳过');
            row(1).style.display = '';
            row(2).querySelector('.mes_text').innerHTML = '<p>x</p>'.repeat(20);   // 第 2 楼比一屏还长
            chat.scrollTop = 280 * 2 + 300;
            check(anchorOf() === row(2), '一条楼盖满整个视口：用它');

            chat.scrollTop = 1500;
            const s0 = chat.scrollTop;
            w.eval('ipeKeepChatView')(() => { row(0).querySelector('.mes_text').lastElementChild.remove(); chat.scrollTop = chat.scrollTop - 60; });
            check(chat.scrollTop === s0 - 60, '浏览器自带滚动锚定已经补过（Chrome）：量出来差 0，不补第二遍');
            const calls = [];
            chat.scrollTo = function (o) { calls.push(o); chat.scrollTop = o.top; };
            const s1 = chat.scrollTop;
            w.eval('ipeKeepChatView')(() => { row(0).querySelector('.mes_text').lastElementChild.remove(); });
            check(calls.length === 1 && calls[0].behavior === 'instant' && chat.scrollTop === s1 - 60, '补的时候用 behavior: instant（主题开了平滑滚动也不会看见它滑）');
            const r = w.eval('ipeKeepChatView')(() => 42);
            check(r === 42, '原样返回改动函数的结果');
        } finally { w.close(); }
    }

    // ── 7. 🎨 按钮：窄屏上把楼头挤成两行时，给视口上面的楼一口气挂一串也不推动眼前的字；都挂好了的扫描不碰排版 ──
    {
        const env = setup(14, { headerWrap: true });
        const { w, tavern, row, rowTop, chat, height } = env;
        try {
            [3, 5, 7].forEach(i => { tavern.chat[i].extra = { ipe_inject_desc: '第 ' + (i + 1) + ' 楼的描述', ipe_inject_env: 'draw' }; });
            chat.scrollTop = 10000;
            const top13 = rowTop(13), s0 = chat.scrollTop, h3 = height(row(3));
            check(row(7).getBoundingClientRect().bottom < 0, '前提：要挂按钮的三楼都在视口上面');
            const n = w.eval('ipeInstallMesButtons')();
            check(n === 3 && !!row(3).querySelector('.ipe-mes-reinject') && height(row(3)) === h3 + 20, '换聊天时挂了 3 颗 🎨，每楼楼头长高 20px');
            check(rowTop(13) === top13 && chat.scrollTop === s0 + 60, '上面一共长了 60px，scrollTop 跟着补，眼前的字不动');
            let reads = 0;
            const proto = w.HTMLElement.prototype, gb = proto.getBoundingClientRect;
            proto.getBoundingClientRect = function () { reads++; return gb.call(this); };
            check(w.eval('ipeInstallMesButtons')() === 0 && reads === 0, '全都挂好了再扫一遍：什么都不改，也不量盒子（不强制排版）');
            proto.getBoundingClientRect = gb;
        } finally { w.close(); }
    }

    // ── 8. 美化把楼里的块重新排座（flex + order）：🐚 抄正文的 order，紧跟在正文底下，还挂在正文外面 ──
    {
        const env = setup(12, { css: '.mes_block{display:flex;flex-direction:column}.mes_text{order:2}.mes_block > details{order:-1}' });
        const { w, tavern, F, row, inline } = env;
        const r = el => el.getBoundingClientRect();
        try {
            w.eval('ipeLedgerInstallInlineObserver()');
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerSync()');
            const blk = row(11).querySelector('.ipe-ledger-inline');
            const mt = row(11).querySelector('.mes_text');
            check(!!blk && blk.previousElementSibling === mt && w.eval('ipeLedgerInlineInside') === false, '还是挂在 .mes_text 后面（正文外），不用退回正文里');
            check(blk.style.getPropertyValue('order') === '2' && blk.style.getPropertyPriority('order') === 'important', '抄了正文的 order: 2（带 !important，压得过主题给 details 的 order）');
            check(r(row(11).querySelector('.ch_name')).bottom <= r(mt).top && r(mt).bottom <= r(blk).top, '排出来是：名字 → 正文 → 🐚');
            const saved = blk.style.cssText;
            blk.style.removeProperty('order');
            check(r(blk).bottom <= r(mt).top, '对照：不抄 order，这套美化会把 🐚 排到正文上面（截图里那样）');
            blk.style.cssText = saved;
            for (let i = 0; i < 3; i++) mt.innerHTML = '<p>正文被重写 ' + i + '</p>';
            await microtasks();
            check(row(11).querySelector('.ipe-ledger-inline') === blk, '正文整块重写照样碰不到它（2.25.0 的好处都在）');

            await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
            const last = addTurn(env, '新楼正文。');
            await tavern.eventSource.emit('MESSAGE_RECEIVED', last, 'normal');
            const mt2 = row(last).querySelector('.mes_text'), blk2 = row(last).querySelector('.ipe-ledger-inline');
            check(inline().length === 1 && !!blk2 && blk2.previousElementSibling === mt2 && r(mt2).bottom <= r(blk2).top, '挪到新楼：紧跟新楼正文，在它底下');
        } finally { w.close(); }
    }

    // ── 9. grid 美化：抄 order 也压不住 → 退回老办法住进正文末尾；生图段贴在 🐚 前面；正文重写当场补回；新楼照样住正文末尾 ──
    {
        const env = setup(12, { layout: 'grid-hole', css: '.mes_block{display:grid}' });
        const { w, tavern, F, row, inline, st } = env;
        const r = el => el.getBoundingClientRect();
        try {
            w.eval('ipeLedgerInstallInlineObserver()');
            st.baseTemplatesJson = JSON.stringify([
                { id: 'tpl_a', name: '水墨', value: '<draw>INK: {Description}</draw>' },
                { id: 'tpl_b', name: '动漫', value: '<draw>ANIME: {Description}</draw>' }]);
            st.activeBaseTemplate = 'tpl_a';
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerSync()');
            const mt = row(11).querySelector('.mes_text');
            const blk = row(11).querySelector('.ipe-ledger-inline');
            check(w.eval('ipeLedgerInlineInside') === true && blk.parentNode === mt && mt.lastElementChild === blk, '量出来 🐚 在正文上面：退回正文末尾住');
            check(!blk.style.getPropertyValue('order') && r(mt.children[mt.children.length - 2]).bottom <= r(blk).top, '住进正文不带 order，排在最后一段正文底下');
            check(fs.readFileSync(__dirname + '/style.css', 'utf8').includes('.mes_text > .ipe-ledger-inline{margin:10px 0 0}'), '住在正文里时外边距还原成老样子（不多缩右边）');

            F('injectDescToMessage')('a girl by the sea', 11);
            const p = mt.querySelector('.ipe-draw-inline');
            check(!!p && p.nextElementSibling === blk && mt.lastElementChild === blk, '绘画注入：生图段贴在 🐚 前面，🐚 还是垫底');
            st.activeBaseTemplate = 'tpl_b';
            F('reinjectDescToMessage')(11, { preferRecord: true });
            const ps = mt.querySelectorAll('.ipe-draw-inline');
            check(ps.length === 1 && ps[0].textContent === '<draw>ANIME: a girl by the sea</draw>' && ps[0].nextElementSibling === blk && mt.lastElementChild === blk, '换画风：原地换，🐚 不被当成旧段摘掉，还是垫底');

            mt.innerHTML = '<p>酒馆重写了正文</p>';
            await microtasks();
            const again = row(11).querySelector('.ipe-ledger-inline');
            check(!!again && again.parentNode === mt && mt.lastElementChild === again && inline().length === 1, '正文被整块重写：观察器当场补回正文末尾');

            await tavern.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
            const last = addTurn(env, '新楼正文。');
            await tavern.eventSource.emit('MESSAGE_RECEIVED', last, 'normal');
            const mt2 = row(last).querySelector('.mes_text');
            check(inline().length === 1 && mt2.lastElementChild === row(last).querySelector('.ipe-ledger-inline'), '新楼：挪进新楼正文末尾，上一楼摘干净');
            check(w.eval('ipeLedgerInlineNeedsPlace()') === false, '住在正文里也算在位，观察器不会来回挪');
            await tavern.eventSource.emit('CHAT_CHANGED');
            check(w.eval('ipeLedgerInlineInside') === false, '换聊天：住哪重新量（不少卡自带美化，楼里怎么排跟着聊天变）');
            await delay(260);
            const blk3 = row(last).querySelector('.ipe-ledger-inline');
            check(w.eval('ipeLedgerInlineInside') === true && inline().length === 1 && !!blk3 && mt2.lastElementChild === blk3, '这个聊天还是 grid 美化：量完又住回正文末尾，只有一块');
        } finally { w.close(); }
    }

    // ── 10. 2.27.9 美化给正文垫了一层、另配了字色：楼里的底纹（z-index 0）压在正文外的东西上面，主题字色又跟底纹一个颜色 → 住进正文末尾 ──
    for (const c of [
        { css: '.mes{color:#f5f4e9} .mes_text{position:relative;z-index:3;color:#1b2722}', inside: true, label: '正文垫了一层（z-index 3）又另配了字色（半卷清欢这类）' },
        { css: '.mes_text{position:relative;z-index:3}', inside: true, label: '只给正文垫了一层、字色一样' },
        { css: '.mes{color:#f5f4e9} .mes_text{color:#1b2722}', inside: true, label: '只给正文另配了字色' },
        { css: '.mes_text{position:relative}', inside: false, label: '正文只是 position:relative，没垫层、没另配字色' },
    ]) {
        const env = setup(12, { css: c.css });
        const { w, F, row, inline } = env;
        try {
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerRenderInline()');
            const mt = row(11).querySelector('.mes_text'), blk = row(11).querySelector('.ipe-ledger-inline');
            if (c.inside) check(w.eval('ipeLedgerInlineInside') === true && inline().length === 1 && blk.parentNode === mt && mt.lastElementChild === blk && w.getComputedStyle(blk).color === w.getComputedStyle(mt).color, c.label + '：🐚 住进正文末尾，跟正文同一层、同一个字色');
            else check(w.eval('ipeLedgerInlineInside') === false && inline().length === 1 && blk.previousElementSibling === mt && !blk.getAttribute('style'), c.label + '：照旧挂在正文外，不加行内样式');
        } finally { w.close(); }
    }

    // ── 11. 2.27.10 垫层、字色只看样式：楼还没排好版也判得出；美化晚到也认；换聊天连「量过」的记号一起清，同一楼也重新量；自检报得出来 ──
    const THEME = '.mes{color:#f5f4e9} .mes_text{position:relative;z-index:3;color:#1b2722}';
    {
        const env = setup(12, { css: THEME });
        const { w, F, row } = env;
        try {
            row(11).style.display = 'none';                                              // 头一回放块时这楼还没排好版：量不出盒子
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerRenderInline()');
            const mt = row(11).querySelector('.mes_text'), blk = row(11).querySelector('.ipe-ledger-inline');
            check(w.eval('ipeLedgerInlineInside') === true && blk.parentNode === mt, '楼还没排好版（量不出盒子）：垫层、字色照样判得出，🐚 住进正文末尾');
            row(11).style.display = '';
            const rep = w.eval('ipeLedgerInlineReport()');
            check(rep.includes('住法：住正文里') && rep.includes('🐚 在：正文里') && rep.includes('正文：z-index 3') && rep.includes('字色 rgb(27, 39, 34)'), '自检报出：住正文里、正文垫在 z-index 3、正文字色', rep);
        } finally { w.close(); }
    }
    {
        const env = setup(12);
        const { w, F, row, d } = env;
        try {
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerRenderInline()');
            const mt = row(11).querySelector('.mes_text'), blk = row(11).querySelector('.ipe-ledger-inline');
            check(w.eval('ipeLedgerInlineInside') === false && blk.previousElementSibling === mt, '前提：没美化，挂在正文外、量过了');
            const rep0 = w.eval('ipeLedgerInlineReport()');
            check(rep0.includes('住法：挂正文外') && rep0.includes('🐚 在：正文外（紧跟正文）') && rep0.includes('量过：是') && !rep0.includes('该住正文里'), '自检报出：挂正文外、量过、不用挪', rep0);
            d.head.insertAdjacentHTML('beforeend', '<style>' + THEME + '</style>');       // 卡自带的美化晚到
            w.eval('ipeLedgerRenderInline()');
            check(w.eval('ipeLedgerInlineInside') === true && blk.parentNode === mt && mt.lastElementChild === blk, '美化晚到（块已经量过、挂在正文外）：下回同步再看一眼样式，住进正文末尾');
        } finally { w.close(); }
    }
    {
        const env = setup(12, { layout: 'grid-hole', css: '.mes_block{display:grid}' });
        const { w, tavern, F, row, inline } = env;
        const r = el => el.getBoundingClientRect();
        try {
            w.eval('ipeLedgerInstallInlineObserver()');
            F('ipeLedgerCommit')('第 12 楼的账本，够长够长够长够长够长。', 12);
            w.eval('ipeLedgerSync()');
            const mt = row(11).querySelector('.mes_text');
            check(w.eval('ipeLedgerInlineInside') === true && mt.lastElementChild === row(11).querySelector('.ipe-ledger-inline'), '前提：grid 美化，量过住在正文末尾');
            await tavern.eventSource.emit('CHAT_CHANGED');                              // 酒馆又发了一次换聊天，楼没重画
            await delay(260);
            const blk = row(11).querySelector('.ipe-ledger-inline');
            check(inline().length === 1 && !!blk && blk.parentNode === mt && r(mt).top <= r(blk).top, '换聊天（楼没重画）：同一楼也重新量，还是住回正文末尾，不跑到正文上面');
        } finally { w.close(); }
    }

    clearTimeout(watchdog);
    console.log('通过 ' + count + ' 项顺滑回归');
})().catch(e => { console.error(e); process.exitCode = 1; clearTimeout(watchdog); });
