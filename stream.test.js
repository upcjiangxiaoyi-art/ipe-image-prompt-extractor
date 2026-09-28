// 生图流式回归（2.26.0 / 2.26.1）：边收边看思考与输出、状态行按阶段走、实况框、开口时限、断流看门狗、打断、整包兜底、开关。
// 用可控时序的假 SSE 响应，不连真 API。
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(r => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.error('test timed out'); process.exit(1); }, 60000);
let count = 0;
const check = (yes, label, extra) => { assert.ok(yes, label + (extra ? '：' + extra : '')); console.log('✓ ' + label); count++; };

const ev = obj => 'data: ' + JSON.stringify(obj) + '\n\n';
const think = t => ev({ choices: [{ delta: { reasoning_content: t } }] });
const say = t => ev({ choices: [{ delta: { content: t } }] });
const stop = (reason) => ev({ choices: [{ delta: {}, finish_reason: reason || 'stop' }] }) + 'data: [DONE]\n\n';
const HANG = { hang: true };

async function setup() {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    d.body.insertAdjacentHTML('beforeend', '<div id="extensions_settings2"></div>');
    w.jQuery = s => { const el = d.querySelector(s); return { length: el ? 1 : 0, append: h => el.insertAdjacentHTML('beforeend', h) }; };
    w.eval('createDrawer(); ipeArrangeUI();');
    w.jQuery = undefined;
    const st = tavern.extensionSettings[F('EXT_NAME')];
    st.apiEndpoint = 'http://x.test/v1'; st.apiKey = 'k'; st.model = 'gpt-4.1';
    st.apiProfilesJson = JSON.stringify([{ id: 'api_1', name: 't', endpoint: 'http://x.test/v1', key: 'k', model: 'gpt-4.1' }]);
    st.enabled = false; st.ledgerAutoRun = false;
    w.eval('window.__st = []; var __oldSet = setStatus; setStatus = function(t, c){ window.__st.push(String(t)); return __oldSet(t, c); };');
    await delay(200);   // 面板控件在 createUI 之后 120ms 才绑
    const sent = [];
    const abortErr = () => new w.DOMException('The user aborted a request.', 'AbortError');
    /* 假中转：steps 依次吐出；数字 = 先等这么多毫秒再吐下一块；HANG = 再也不吐（只能被中止）；'HEADERS_HANG' 放在最前 = 连响应头都不回 */
    const serve = (steps, extra) => {
        w.fetch = (url, o) => {
            sent.push(JSON.parse(o.body));
            const signal = o.signal;
            if (steps[0] === 'HEADERS_HANG') return new Promise((_, reject) => signal && signal.addEventListener('abort', () => reject(abortErr()), { once: true }));
            if (extra && extra.status) return Promise.resolve({ ok: false, status: extra.status, text: async () => extra.body || '' });
            if (extra && extra.json) return Promise.resolve({ ok: true, status: 200, text: async () => extra.json });
            let i = 0;
            const read = () => new Promise((resolve, reject) => {
                if (signal && signal.aborted) return reject(abortErr());
                const onAbort = () => reject(abortErr());
                if (signal) signal.addEventListener('abort', onAbort, { once: true });
                let wait = 0;
                while (typeof steps[i] === 'number') wait += steps[i++];
                const step = steps[i++];
                if (step === HANG) return;
                setTimeout(() => {
                    if (signal) signal.removeEventListener('abort', onAbort);
                    if (step === undefined) resolve({ done: true });
                    else resolve({ done: false, value: new TextEncoder().encode(step) });
                }, wait);
            });
            return Promise.resolve({ ok: true, status: 200, body: { getReader: () => ({ read }) }, text: async () => steps.filter(s => typeof s === 'string').join('') });
        };
    };
    const $ = id => d.querySelector('#' + id);
    const statuses = () => w.__st.slice();
    const lastFail = () => w.__st.filter(t => t.startsWith('失败: ')).pop() || '';   // 失败后排重试还会再写一条「10 秒后自动重试」
    const run = () => F('runExtract')(tavern.chat[9].mes, '', false, 9);
    return { w, tavern, F, st, d, $, serve, sent, statuses, lastFail, run };
}

(async () => {
    // ── 1. 边收边看：思考先到、正文后到；状态行按阶段走；实况框面板、抽屉两边都有；跑完留着 ──
    {
        const env = await setup();
        const { w, $, serve, sent, statuses, run } = env;
        try {
            serve([think('先看这段是'), 450, think('夜里海边，两个人。'), 450, say('Two figures '), 450, say('on a moonlit beach.'), 50, stop()]);
            const snaps = [];
            const sampler = setInterval(() => snaps.push({ think: $('ipe-live-think').textContent, out: $('ipe-live-out').textContent, status: $('ipe-status').textContent }), 60);
            await run();
            clearInterval(sampler);
            check(sent[0].stream === true, '请求体 stream: true（默认开流式）');
            check($('ipe-preview-text').value === 'Two figures on a moonlit beach.', '预览框拿到的是拼好的正文', $('ipe-preview-text').value);
            const s = statuses();
            check(s.some(t => t.startsWith('正在提取…连接中')), '状态行先报「连接中」');
            check(s.some(t => t.startsWith('正在提取…已连上，等模型开口')), '响应头一到就报「已连上，等模型开口」——连没连上一眼就知道');
            check(s.some(t => /^正在提取…模型思考中，已想 \d+ 字 · \d+ \/ 120 秒$/.test(t)), '思考阶段报想了多少字、几秒；还没开口，秒数带着 120 秒时限', s.join(' | '));
            check(s.some(t => /^正在提取…模型输出中，已写 \d+ 字 · \d+ 秒$/.test(t)), '输出阶段报写了多少字、几秒');
            check(s[s.length - 1].startsWith('提取完成'), '收完照旧写「提取完成」', s[s.length - 1]);
            check(snaps.some(x => x.think.includes('先看这段是') && x.out === ''), '还没开始写时，实况框里已经看得到它在想什么');
            check(snaps.some(x => x.out === 'Two figures ' ), '正文是一块一块长出来的（中途看到过半截）');
            check($('ipe-live').style.display !== 'none' && $('ipe-live-think').textContent === '先看这段是夜里海边，两个人。' && $('ipe-live-out').textContent === 'Two figures on a moonlit beach.', '跑完实况框留着：思考和输出都在');
            check(/^✓ 完成 · 思考 \d+ 字 · 输出 \d+ 字 · \d+ 秒$/.test($('ipe-live-meta').textContent), '实况框标题写「✓ 完成 · 思考 · 输出 · 秒数」', $('ipe-live-meta').textContent);
            check($('iped-live').style.display !== 'none' && $('iped-live-out').textContent === 'Two figures on a moonlit beach.' && $('iped-live-title').textContent === '🎨 提取实况', '酒馆抽屉里的实况框同步');
            check($('ipe-btn-stop').disabled, '收完「打断请求」按钮复位');
        } finally { w.close(); }
    }

    // ── 2. 正文开头的 <think> 块算思考、不进描述；标签被切在两块之间也认得 ──
    {
        const { w, $, serve, run } = await setup();
        try {
            serve([say('<thi'), 20, say('nk>构图：远景'), 20, say('，低机位</think>\n\nA quiet harbor '), 20, say('at dusk.'), stop()]);
            await run();
            check($('ipe-preview-text').value === 'A quiet harbor at dusk.', '<think>…</think> 剥掉，描述只剩正文', $('ipe-preview-text').value);
            check($('ipe-live-think').textContent === '构图：远景，低机位' && $('ipe-live-out').textContent === 'A quiet harbor at dusk.', '实况框里 <think> 那段显示成思考');
        } finally { w.close(); }
    }

    // ── 3. 中转不认流式：要了 stream 却整包 JSON 回来 → 照整包解析；「流式接收」关掉 → stream:false、老的整包干等 ──
    {
        const { w, $, st, serve, sent, statuses, run } = await setup();
        try {
            serve([JSON.stringify({ choices: [{ message: { content: 'Whole JSON desc.' }, finish_reason: 'stop' }] })]);
            await run();
            check($('ipe-preview-text').value === 'Whole JSON desc.' && $('ipe-live-out').textContent === 'Whole JSON desc.', '整包 JSON 回来照样收下，实况框也显示');
            const cb = $('ipe-img-stream'), cbd = $('iped-img-stream');
            check(cb.checked && cbd.checked, '两处「流式接收」默认勾着');
            cb.checked = false; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
            check(st.imgStream === false && !cbd.checked, '关掉：存进设置，抽屉那个勾同步');
            serve([], { json: JSON.stringify({ choices: [{ message: { content: 'Old way desc.' } }] }) });
            w.__st.length = 0;
            await run();
            check(sent[1].stream === false && $('ipe-preview-text').value === 'Old way desc.', '关了就发 stream:false，整包解析');
            check(statuses().some(t => t.startsWith('正在提取…已连上，等整包回来（流式接收关着）')), '整包等待时状态行也按秒走，并说明流式关着');
            const open = $('iped-img-open');
            check($('ipe-img-open').value === '120' && open.value === '120', '开口时限默认 120 秒，两处都显示');
            open.value = '45'; open.dispatchEvent(new w.Event('change', { bubbles: true }));
            check(st.imgOpenTimeout === 45 && $('ipe-img-open').value === '45', '改开口时限存进设置，另一处同步');
        } finally { w.close(); }
    }

    // ── 4. 开口时限（2.26.1）：从发请求起算 N 秒还没写出正文就掐——没响应、光思考、光心跳都算没开口；开口之后只防断流 ──
    {
        const { w, $, st, serve, statuses, lastFail, run } = await setup();
        const cards = () => [...w.document.querySelectorAll('#ipe-notice-stack .ipe-notice')];
        try {
            st.imgOpenTimeout = 1;
            serve(['HEADERS_HANG']);
            let t0 = Date.now();
            await run();
            let last = lastFail();
            check(Date.now() - t0 < 1900 && last === '失败: 「gpt-4.1」1 秒没开口（连响应都没等到），已掐断', '连响应都没有：1 秒到点就掐，说清卡在哪', last);
            check(statuses().pop() === '「gpt-4.1」1 秒没开口（连响应都没等到），已掐断，10 秒后自动重来一次…', '第一次没开口：状态行说一声，排自动重来');
            check(cards().length === 0, '第一次没开口不弹窗');
            check($('ipe-live-meta').textContent.startsWith('✗ 1 秒没开口'), '实况框标「✗ 1 秒没开口」');
            w.eval('ipeClearApiRetry()');

            serve([think('想到一半'), 300, think('，还在想'), HANG]);
            t0 = Date.now();
            await run();
            last = lastFail();
            check(Date.now() - t0 < 1900 && /1 秒没开口（一直在想，已想 8 字，正文一个字没写）/.test(last), '光思考不算开口：到点照样掐', last);
            check($('ipe-live-think').textContent === '想到一半，还在想', '掐之前想的那些还留在实况框里');
            w.eval('ipeClearApiRetry()');

            serve([': keepalive\n\n', 300, ': keepalive\n\n', 300, ': keepalive\n\n', 300, ': keepalive\n\n', 300, ': keepalive\n\n', HANG]);
            t0 = Date.now();
            await run();
            last = lastFail();
            check(Date.now() - t0 < 1900 && /1 秒没开口（连上了，但一个字都没写）/.test(last), '中转一直发心跳、就是不出字：只看字节的看门狗判不死，开口时限照样掐', last);
            w.eval('ipeClearApiRetry()');

            w.__st.length = 0;
            serve([say('Two '), HANG]);
            t0 = Date.now();
            await run();
            last = lastFail();
            const took = Date.now() - t0;
            check(took >= 1900 && /^失败: 提取超时：连续 2 秒没收到模型任何字节/.test(last), '开口之后不卡时限，只防断流：卡住 2 倍时长才断（' + took + 'ms）', last);
            check(statuses().pop() === 'API 请求失败，10 秒后自动重试一次…' && cards().length === 1, '断流按普通失败走：照旧弹卡、照旧重试');
            w.eval('ipeClearApiRetry()');
            cards().forEach(c => c.remove());

            w.__st.length = 0;
            serve([500, say('Quick '), 600, say('answer.'), stop()]);
            await run();
            check($('ipe-preview-text').value === 'Quick answer.', '半秒就开口：写得慢也不掐（总共 1.1 秒 > 时限 1 秒）');
            const s = statuses();
            check(s.some(t => / · 0 \/ 1 秒$/.test(t)) && s.some(t => /^正在提取…模型输出中，已写 \d+ 字 · \d+ 秒$/.test(t)), '没开口时秒数带时限「0 / 1 秒」，开口后只报秒数', s.join(' | '));
        } finally { w.close(); }
    }

    // ── 4b. 重来一次还不开口：弹常驻窗点名这个模型，劝换一个 ──
    {
        const { w, tavern, F, st, serve, statuses } = await setup();
        const cards = () => [...w.document.querySelectorAll('#ipe-notice-stack .ipe-notice')];
        try {
            st.imgOpenTimeout = 1;
            serve(['HEADERS_HANG']);
            await F('runExtract')(tavern.chat[9].mes, '', false, 9, 1);   // retryAttempt = 1：这是自动重来的那一次
            const card = cards().pop();
            check(!!card && card.getAttribute('data-ipe-sticky') === '1' && !!card.querySelector('.ipe-notice-ok'), '重来还不开口：弹常驻卡（要点「知道了」才关）');
            check(card.querySelector('.ipe-notice-title').textContent === '🐚 这个模型这会儿 gg 了', '卡片标题直说这个模型 gg 了');
            const body = card.querySelector('.ipe-notice-body').textContent;
            check(body.includes('「gpt-4.1」1 秒没开口') && body.includes('先换个 API 预设或模型') && body.includes('开口时限'), '卡片点名模型、劝换一个，也说了时限在哪调', body);
            check(!statuses().some(t => t.includes('10 秒后自动重')), '不再排第三次');
        } finally { w.close(); }
    }

    // ── 4c. 自动提取人物外貌不卡开口：资料多要想得久，只要字节在流就不掐；2.26.0 改过的「空闲超时」带进「开口时限」 ──
    {
        const { w, st, serve, statuses } = await setup();
        try {
            st.imgOpenTimeout = 1;
            serve([think('读资料'), 700, think('，比对'), 700, think('，整理'), 700, say('【X】\n外貌: y'), stop()]);
            const t0 = Date.now();
            const out = await w.eval('ipeCastScanCall')('资料', 'user', '🔍 ');
            check(out === '【X】\n外貌: y' && Date.now() - t0 >= 2000, '想了 2 秒多才开口也不掐（只防断流）');
            check(!statuses().some(t => / \/ 1 秒/.test(t)), '外貌整理的秒数不带时限');
            delete st.imgOpenTimeout; st.imgIdleTimeout = 45; w.eval('loadSettings()');
            check(st.imgOpenTimeout === 45, '2.26.0 里把空闲超时改成 45：升级后开口时限也是 45');
            delete st.imgOpenTimeout; st.imgIdleTimeout = 0; w.eval('loadSettings()');
            check(st.imgOpenTimeout === 0, '改成 0（不限）的也带过来');
            delete st.imgOpenTimeout; st.imgIdleTimeout = 120; w.eval('loadSettings()');
            check(st.imgOpenTimeout === 120, '没改过的用新默认 120');
        } finally { w.close(); }
    }

    // ── 5. 手点「打断请求」：原样中止，不重试；HTTP 报错照旧报状态码 ──
    {
        const { w, $, serve, statuses, lastFail, run } = await setup();
        try {
            serve([say('Half a '), HANG]);
            const p = run();
            await delay(150);
            check(!$('ipe-btn-stop').disabled, '请求进行中「打断请求」可点');
            const before = statuses().length;
            $('ipe-btn-stop').click();
            await p;
            check(statuses().pop() === '失败: 请求已被打断' && !statuses().slice(before).some(t => t.includes('自动重试')), '手动打断：报「请求已被打断」，不自动重试');
            check($('ipe-live-meta').textContent.startsWith('⏹ 已中止') && $('ipe-live-out').textContent === 'Half a ', '实况框标「⏹ 已中止」，已收的半截留着');
            serve([], { status: 502, body: 'bad gateway' });
            await run();
            check(lastFail().startsWith('失败: API 502：bad gateway') && statuses().pop().includes('自动重试'), 'HTTP 报错照旧报状态码和原文，照旧排自动重试');
            w.eval('ipeClearApiRetry()');
        } finally { w.close(); }
    }

    // ── 6. 空回复说清原因；老整包路的 reasoning_content 兜底流式照做；OpenRouter 的 reasoning_details 也认 ──
    {
        const { w, $, serve, lastFail, run } = await setup();
        try {
            serve([think('想了很多很多'), stop('length')]);
            await run();
            const last = lastFail();
            check(/finish_reason=length/.test(last) && /思考已用掉 6 字/.test(last), '只想没写被截断：点名 finish_reason=length 和思考用掉多少', last);
            w.eval('ipeClearApiRetry()');
            serve([think('Only reasoning carries the answer.'), stop()]);
            await run();
            check($('ipe-preview-text').value === 'Only reasoning carries the answer.', '正文空、中转把答案塞在 reasoning_content：照老整包路兜底拿它');
            serve([ev({ choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: '细节格式的思考' }] } }] }), say('Detail desc.'), stop()]);
            await run();
            check($('ipe-live-think').textContent === '细节格式的思考' && $('ipe-preview-text').value === 'Detail desc.', 'reasoning_details 里的思考也显示出来');
        } finally { w.close(); }
    }

    // ── 7. 分层：层标签被切在两块之间也照样拆五层 ──
    {
        const { w, $, st, serve, run } = await setup();
        try {
            st.imgLayered = true;
            serve([say('<camera>wide shot</cam'), 10, say('era>\n<env>pier at night</env>\n<mood>cold blue'), 10, say('</mood>\n<chars>two people</chars>\n<pose>leaning on the rail</pose>'), stop()]);
            await run();
            check($('ipe-layer-camera').value === 'wide shot' && $('ipe-layer-mood').value === 'cold blue' && $('ipe-layer-pose').value === 'leaning on the rail', '流式收完再拆层：标签切在两块中间也拆对');
        } finally { w.close(); }
    }

    // ── 8. 自动提取人物外貌也走流式，状态行接着它自己的前缀报进度 ──
    {
        const { w, serve, sent, statuses } = await setup();
        try {
            serve([think('找人物'), 450, say('【Lin Yu】\n外貌: young man, '), 450, say('short black hair'), stop()]);
            const out = await w.eval('ipeCastScanCall')('资料', 'user', '🔍 测试资料。副 AI 正在整理人物外貌…');
            check(sent[0].stream === true && out === '【Lin Yu】\n外貌: young man, short black hair', '外貌整理请求 stream: true，拼好的结果原样返回');
            check(statuses().some(t => /^🔍 测试资料。副 AI 正在整理人物外貌…模型(思考|输出)中/.test(t)), '状态行接着「副 AI 正在整理人物外貌…」往后报进度');
            check(w.document.querySelector('#ipe-live-title').textContent === '🔍 外貌整理实况', '实况框标题换成「外貌整理实况」');
        } finally { w.close(); }
    }

    clearTimeout(watchdog);
    console.log('通过 ' + count + ' 项生图流式回归');
})().catch(e => { console.error(e); process.exitCode = 1; clearTimeout(watchdog); });
