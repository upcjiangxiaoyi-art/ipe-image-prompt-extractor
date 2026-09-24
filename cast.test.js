// 🧷 人物锁（2.20.0）回归：角色卡外貌原样贴入、入镜判断、换装沿用、温度。
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const LOOK_LIN = 'young man, early 20s, short messy black hair, amber eyes, slim tall build';
const LOOK_SU = 'young woman, long wavy chestnut hair, green eyes, petite';
const ANCHORS = '陆家两位主角\n【Lin Yu】\n外貌: ' + LOOK_LIN + '\n服装: white oversized shirt, black slacks\n别名: 林屿, 小屿\n性格：嘴硬\n\n【Su Wan】\n外貌: ' + LOOK_SU + '.\n服装: navy school uniform\n\n【路人】\n一些备注';
let count = 0;
const check = (yes, label, extra) => { assert.ok(yes, label + (extra ? '：' + extra : '')); console.log('✓ ' + label); count++; };

async function setup(opts) {
    const { w, tavern, F } = boot(10);
    const st = tavern.extensionSettings[F('EXT_NAME')];
    st.apiEndpoint = 'http://x.test/v1'; st.apiKey = 'k'; st.model = 'gpt-4.1';
    st.apiProfilesJson = JSON.stringify([{ id: 'api_1', name: 't', endpoint: 'http://x.test/v1', key: 'k', model: 'gpt-4.1' }]);
    st.anchorPresetsJson = JSON.stringify([{ id: 'anchor_1', name: '主角', value: ANCHORS }]);
    st.activeAnchorPreset = 'anchor_1';
    Object.assign(st, opts || {});
    const cap = {};
    const api = content => { w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) }; }; };
    const box = id => { const el = w.document.querySelector('#' + id); return el ? el.value : null; };
    const run = () => F('runExtract')(tavern.chat[9].mes, '', false, 9);
    await new Promise(r => setTimeout(r, 200));   // 面板控件在 createUI 之后 120ms 才绑
    return { w, tavern, F, st, cap, api, box, run };
}

(async () => {
    {
        const { w } = await setup();
        const cards = w.eval('ipeCastCards()');
        check(cards.length === 2, '只认有外貌行的卡：Lin Yu、Su Wan，路人没外貌不算', JSON.stringify(cards.map(c => c.name)));
        check(cards[0].aliases.join('|') === '林屿|小屿', '别名拆好');
        check(w.eval('ipeCastParse("陆星河：a man, 28 years old").length') === 0, '老格式锚点不当卡片，人物锁不生效');
    }
    console.log('\n【整段】外貌原样贴在最前，副 AI 的 cast / outfit 标签被摘掉');
    {
        const { w, cap, api, box, run } = await setup();
        api('Lin Yu leans on the balcony railing at night, smiling at 苏晚 off-frame.\n<cast>林屿</cast>\n<outfit>NO_CHANGE</outfit>');
        await run();
        const u = cap.body.messages[1].content;
        check(u.indexOf('【人物锁】') >= 0 && u.indexOf('<cast>') >= 0, '请求里带人物锁约定');
        check(u.indexOf('Lin Yu（又名 林屿 / 小屿）：white oversized shirt, black slacks') >= 0, '约定里列出角色、别名与当前服装');
        check(cap.body.temperature === 0.2, '默认温度 0.2', String(cap.body.temperature));
        const pv = box('ipe-preview-text');
        check(pv.indexOf('Lin Yu: ' + LOOK_LIN + '. Wearing white oversized shirt, black slacks. Lin Yu leans') === 0, '外貌与服装一字不差贴在最前', pv);
        check(pv.indexOf('<cast>') < 0 && pv.indexOf('<outfit>') < 0 && pv.indexOf('NO_CHANGE') < 0, '标签不漏进提示词');
        check(pv.indexOf(LOOK_SU) < 0, '没入镜的 Su Wan 不贴');
        check(w.document.querySelector('#ipe-status').textContent.indexOf('人物锁：Lin Yu') >= 0, '状态行报入镜角色');
    }
    console.log('\n【换装】记进本聊天，下一楼沿用；多人按卡片顺序');
    {
        const { w, cap, api, box, run } = await setup();
        api('They sit on the sofa.\n<cast>Su Wan, Lin Yu</cast>\n<outfit>Su Wan: oversized grey hoodie, pajama shorts</outfit>');
        await run();
        let pv = box('ipe-preview-text');
        check(pv.indexOf('Lin Yu: ') === 0 && pv.indexOf('Su Wan: ' + LOOK_SU + '. Wearing oversized grey hoodie, pajama shorts.') > 0, '按卡片顺序，换装立刻生效，外貌末尾句号不叠', pv);
        check(box('ipe-cast-outfits').indexOf('Su Wan: oversized grey hoodie, pajama shorts') >= 0, '服装框显示本聊天服装');
        api('Su Wan dozes off.\n<cast>Su Wan</cast>\n<outfit>NO_CHANGE</outfit>');
        await run();
        pv = box('ipe-preview-text');
        check(pv.indexOf('Wearing oversized grey hoodie') > 0 && pv.indexOf('Lin Yu') < 0, '下一楼沿用换装，没入镜的不贴', pv);
        check(cap.body.messages[1].content.indexOf('Su Wan：oversized grey hoodie') >= 0, '请求里告诉副 AI 当前服装');
        const ta = w.document.querySelector('#ipe-cast-outfits');
        ta.value = 'Lin Yu: black suit\nSu Wan: navy school uniform'; ta.dispatchEvent(new w.Event('change'));
        check(JSON.stringify(w.eval('ipeCastOutfitsRead()')) === '{"Lin Yu":"black suit"}', '手改服装：只记跟卡片默认不同的');
        w.document.querySelector('#ipe-cast-outfits-reset').click();
        check(JSON.stringify(w.eval('ipeCastOutfitsRead()')) === '{}', '恢复卡片默认');
    }
    console.log('\n【兜底】副 AI 没写 <cast> 就看正文点名；写 NONE 就不贴');
    {
        const { api, box, run } = await setup();
        api('小屿 walks alone in the rain.');
        await run();
        check(box('ipe-preview-text').indexOf('Lin Yu: ') === 0, '别名点名也认');
        api('An empty street at dawn.\n<cast>NONE</cast>');
        await run();
        check(box('ipe-preview-text') === 'An empty street at dawn.', 'NONE → 不贴任何外貌');
    }
    console.log('\n【分层】人物层 = 外貌段 + 此刻状态；锁住的人物层不动');
    {
        const { w, cap, st, api, box, run } = await setup({ imgLayered: true });
        api('<camera>close-up.</camera>\n<env>kitchen.</env>\n<mood>warm.</mood>\n<chars>Lin Yu, flushed, avoiding eye contact.</chars>\n<pose>he stirs the pot.</pose>\n<cast>Lin Yu</cast>\n<outfit>Lin Yu: black apron over white shirt</outfit>');
        await run();
        check(cap.body.messages[1].content.indexOf('锚点角色的固定外貌与服装由插件贴入') >= 0, '分层约定里人物层改为只写此刻状态');
        check(box('ipe-layer-chars') === 'Lin Yu: ' + LOOK_LIN + '. Wearing black apron over white shirt. Lin Yu, flushed, avoiding eye contact.', '人物层前面是原样外貌', box('ipe-layer-chars'));
        check(box('ipe-layer-pose') === 'he stirs the pot.', '动作层没被 <cast> 吃掉');
        const before = box('ipe-layer-chars');
        st.imgLockChars = true;
        api('<camera>wide.</camera>\n<env>NO_CHANGE</env>\n<mood>NO_CHANGE</mood>\n<chars>NO_CHANGE</chars>\n<pose>he turns.</pose>\n<cast>Lin Yu</cast>');
        await run();
        check(box('ipe-layer-chars') === before, '人物层锁着 → 不重复贴外貌');
        st.imgLockChars = false;
        api('<camera>wide.</camera>\n<env>NO_CHANGE</env>\n<mood>NO_CHANGE</mood>\n<chars></chars>\n<pose>he turns.</pose>\n<cast>Lin Yu</cast>');
        await run();
        check(box('ipe-layer-chars') === 'Lin Yu: ' + LOOK_LIN + '. Wearing black apron over white shirt.', '副 AI 人物层空着 → 只留外貌段，不拿上一楼的表情', box('ipe-layer-chars'));
        check(w.eval('buildInjectTag(' + JSON.stringify(box('ipe-preview-text')) + ')').indexOf('<draw>') === 0, '注入模板照常');
    }
    console.log('\n【建卡】给当前角色建空卡，不重复，清掉老版 Lin Yu 示例（2.20.1）');
    {
        const OLD = '【Lin Yu】\n外貌: young man, early 20s, short messy black hair, amber eyes, pale skin, slim tall build\n服装: white oversized shirt, black slacks\n别名: 林屿, 小屿';
        const { w, st } = await setup();
        st.anchorPresetsJson = JSON.stringify([{ id: 'anchor_1', name: '主角', value: '苑无忧：a woman\n\n' + OLD + '\n\n' + OLD }]);
        check(w.eval('ipeCastCards()').length === 1, '同名卡只认一张');
        w.document.querySelector('#ipe-cast-sample').click();
        w.document.querySelector('#ipe-cast-sample').click();
        const v = JSON.parse(st.anchorPresetsJson)[0].value;
        check(v.indexOf('Lin Yu') < 0, '老版 Lin Yu 示例被清掉', v);
        check(v.split('【苑无忧】').length === 2, '点两下只建一张当前角色的卡', v);
        check(v.indexOf('苑无忧：a woman') === 0, '原有锚点文字不动');
        check(w.eval('ipeCastCards()').length === 0 && !w.eval('ipeCastActive()'), '外貌没填的空卡不生效');
        check(w.document.querySelector('#ipe-char-anchors').value === v, '锚点框同步显示');
    }
    console.log('\n【开关】人物锁关掉 / 温度留空');
    {
        const { cap, api, box, run } = await setup({ imgCastLock: false, imgTemperature: '' });
        api('Lin Yu smiles.\n');
        await run();
        check(cap.body.messages[1].content.indexOf('【人物锁】') < 0 && box('ipe-preview-text') === 'Lin Yu smiles.', '关掉就是老办法');
        check(!('temperature' in cap.body), '温度留空 → 不发 temperature');
    }
    console.log('通过 ' + count + ' 项人物锁回归');
})().catch(e => { console.error(e.message); process.exit(1); });
