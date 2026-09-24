// 🧷 人物锁回归：长相原样贴入、入镜判断、自动提取人物外貌、温度（2.22.0 起只锁长相，服装交给副 AI）。
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
        check(u.indexOf('Lin Yu（又名 林屿 / 小屿）、Su Wan') >= 0, '约定里列出人物与别名');
        check(u.indexOf(LOOK_LIN) < 0 && u.indexOf('【Lin Yu】') >= 0 && u.indexOf('性格：嘴硬') >= 0 && u.indexOf('服装: white oversized shirt') >= 0, '外貌行不再发给副 AI，人物段里的其他行（性格、手写服装）照发');
        check(u.indexOf('陆家两位主角') >= 0 && u.indexOf('【路人】') >= 0, '段外自由文字照发');
        check(cap.body.temperature === 0.2, '默认温度 0.2', String(cap.body.temperature));
        const pv = box('ipe-preview-text');
        check(pv.indexOf('Lin Yu: ' + LOOK_LIN + '. Lin Yu leans') === 0, '长相一字不差贴在最前，不贴服装', pv);
        check(pv.indexOf('<cast>') < 0 && pv.indexOf('<outfit>') < 0 && pv.indexOf('NO_CHANGE') < 0, '标签不漏进提示词');
        check(pv.indexOf(LOOK_SU) < 0, '没入镜的 Su Wan 不贴');
        check(w.document.querySelector('#ipe-status').textContent.indexOf('人物锁：Lin Yu') >= 0, '状态行报入镜角色');
    }
    console.log('\n【多人】按锚点顺序贴，句号不叠');
    {
        const { api, box, run } = await setup();
        api('They sit on the sofa.\n<cast>Su Wan, Lin Yu</cast>');
        await run();
        check(box('ipe-preview-text') === 'Lin Yu: ' + LOOK_LIN + '. Su Wan: ' + LOOK_SU + '. They sit on the sofa.', '按锚点顺序，外貌末尾句号不叠', box('ipe-preview-text'));
    }
    console.log('\n【兜底】副 AI 没写 <cast> 就看正文点名；写 NONE 就不贴');
    {
        const { w, api, box, run } = await setup();
        api('小屿 walks alone in the rain.');
        await run();
        check(box('ipe-preview-text').indexOf('Lin Yu: ') === 0, '别名点名也认');
        api('An empty street at dawn.\n<cast>NONE</cast>');
        await run();
        check(box('ipe-preview-text') === 'An empty street at dawn.', 'NONE → 不贴任何外貌');
        api('Lin Yu stands on the veranda, looking back.\n<cast>NONE</cast>');
        await run();
        check(box('ipe-preview-text').indexOf('Lin Yu: ' + LOOK_LIN) === 0, '<cast> 写 NONE 但描述里写了名字 → 照贴', box('ipe-preview-text'));
        api('Lin Yu stands on the veranda.\n<cast>Lu Jibei</cast>');
        await run();
        check(box('ipe-preview-text').indexOf('Lin Yu: ' + LOOK_LIN) === 0, '<cast> 写了对不上的名字，描述里有名字 → 照贴');
        api('An empty veranda.\n<cast>Lu Jibei</cast>');
        await run();
        check(w.document.querySelector('#ipe-status').textContent.indexOf('锚点里对不上号') >= 0, '<cast> 对不上号时状态行说出来');
    }
    console.log('\n【分层】人物层 = 外貌段 + 此刻状态；锁住的人物层不动');
    {
        const { w, cap, st, api, box, run } = await setup({ imgLayered: true });
        api('<camera>close-up.</camera>\n<env>kitchen.</env>\n<mood>warm.</mood>\n<chars>Lin Yu, flushed, avoiding eye contact.</chars>\n<pose>he stirs the pot.</pose>\n<cast>Lin Yu</cast>\n<outfit>老版本的换装标签</outfit>');
        await run();
        check(cap.body.messages[1].content.indexOf('人物锁里人物的固定长相由插件贴入') >= 0, '分层约定里人物层改为只写服装与此刻状态');
        check(box('ipe-layer-chars') === 'Lin Yu: ' + LOOK_LIN + '. Lin Yu, flushed, avoiding eye contact.', '人物层前面是原样长相', box('ipe-layer-chars'));
        check(box('ipe-preview-text').indexOf('老版本的换装标签') < 0, '副 AI 照老习惯写的 <outfit> 也摘掉');
        check(box('ipe-layer-pose') === 'he stirs the pot.', '动作层没被 <cast> 吃掉');
        const before = box('ipe-layer-chars');
        st.imgLockChars = true;
        api('<camera>wide.</camera>\n<env>NO_CHANGE</env>\n<mood>NO_CHANGE</mood>\n<chars>NO_CHANGE</chars>\n<pose>he turns.</pose>\n<cast>Lin Yu</cast>');
        await run();
        check(box('ipe-layer-chars') === before, '人物层锁着 → 不重复贴外貌');
        st.imgLockChars = false;
        api('<camera>wide.</camera>\n<env>NO_CHANGE</env>\n<mood>NO_CHANGE</mood>\n<chars></chars>\n<pose>he turns.</pose>\n<cast>Lin Yu</cast>');
        await run();
        check(box('ipe-layer-chars') === 'Lin Yu: ' + LOOK_LIN + '.', '副 AI 人物层空着 → 只留外貌段，不拿上一楼的表情', box('ipe-layer-chars'));
        check(w.eval('buildInjectTag(' + JSON.stringify(box('ipe-preview-text')) + ')').indexOf('<draw>') === 0, '注入模板照常');
    }
    console.log('\n【自动提取】读角色卡 + user 设定 + 世界书，副 AI 整理外貌，存成新锚点预设（2.21.0）');
    {
        const { w, tavern, st, cap } = await setup();
        st.anchorPresetsJson = JSON.stringify([{ id: 'anchor_1', name: '我自己写的', value: '随便写的锚点，没有格式' }]);
        let unshallow = 0;
        tavern.name1 = '小雨'; tavern.name2 = '苑无忧';
        tavern.characters[0] = { name: '苑无忧', avatar: 'yuan.png', shallow: true, description: '{{char}}是个高个子女人，黑色长发，灰色眼睛。{{user}}是她的学生。', personality: '冷淡', scenario: '', data: { extensions: { world: '苑家世界书' }, character_book: { entries: [{ comment: '管家', content: '老陈，六十岁，白发，驼背，总穿灰色长衫。', enabled: true }] } } };
        tavern.unshallowCharacter = async () => { unshallow++; };
        tavern.substituteParams = t => t.replace(/\{\{char\}\}/g, '苑无忧').replace(/\{\{user\}\}/g, '小雨');
        tavern.powerUserSettings = { persona_description: '小雨，十八岁，短发，戴圆框眼镜。' };
        tavern.chatMetadata = tavern.chatMetadata || {};
        tavern.chatMetadata.world_info = '聊天世界书';
        const books = {
            '苑家世界书': { entries: { 1: { comment: '管家', content: '老陈，六十岁，白发，驼背，总穿灰色长衫。', key: ['老陈'] }, 2: { comment: '关了的', content: '不该出现的条目', disable: true } } },
            '聊天世界书': { entries: { 5: { comment: '城市', content: '一座常年下雨的港口城市。', key: ['港口'] } } }
        };
        books['全局书'] = { entries: { 9: { comment: '邻居', content: '邻居阿福，圆脸，红头发。', key: ['阿福'] } } };
        tavern.loadWorldInfo = async n => books[n] || null;
        w.document.body.insertAdjacentHTML('beforeend', '<select id="world_info" multiple><option selected>全局书</option><option>没开的书</option></select>');
        const reply = '```\n【苑无忧】\n外貌: tall woman, late 20s, long straight black hair, grey eyes, pale skin, slender build\n服装: dark trench coat\n别名: 苑老师\n\n【小雨】\n外貌: 18-year-old girl, short black bob, round glasses, petite\n服装:\n别名:\n\n【老陈】\n外貌: \n```';
        w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: reply } }] }) }; };
        await w.eval('ipeCastScan()');
        const sent = cap.body.messages[1].content;
        check(unshallow === 1, '先让酒馆补全懒加载的角色卡');
        check(sent.indexOf('苑无忧是个高个子女人') >= 0 && sent.indexOf('小雨是她的学生') >= 0, '角色卡读到了，宏替换成名字');
        check(sent.indexOf('十八岁，短发') >= 0, 'user 设定读到了');
        check(sent.indexOf('一座常年下雨的港口城市') >= 0, '聊天绑定的世界书读到了');
        check(sent.split('老陈，六十岁').length === 2, '内嵌世界书与导入后的世界书同内容只带一次');
        check(sent.indexOf('不该出现的条目') < 0, '关掉的世界书条目不带');
        check(sent.indexOf('邻居阿福，圆脸，红头发') >= 0, '全局启用的世界书读到了（面板多选框兜底）');
        const stLine = w.document.querySelector('#ipe-status').textContent;
        check(stLine.indexOf('世界书 3 本（苑家世界书、聊天世界书、全局书）') >= 0 && stLine.indexOf('整理出 2 个人物') >= 0, '成功后状态行仍写明读了哪几本世界书', stLine);
        check(cap.body.messages[0].content.indexOf('小雨') >= 0, '提取提示里点名 user 叫什么');
        check(cap.body.messages[0].content.indexOf('发色最要紧') >= 0 && cap.body.messages[0].content.indexOf('辨识度') >= 0, '提取提示强调发色与辨识度特征');
        check(!/服装:|别名:/.test(cap.body.messages[0].content), '提取格式里没有服装、别名字段');
        const list = JSON.parse(st.anchorPresetsJson);
        const auto = list.find(x => x.name === '🔍 苑无忧');
        check(!!auto && st.activeAnchorPreset === auto.id, '存成「🔍 苑无忧」预设并选中');
        check(list.find(x => x.name === '我自己写的').value === '随便写的锚点，没有格式', '自己写的锚点预设原样保留');
        check(w.eval('ipeCastCards().map(c => c.name).join()') === '苑无忧,小雨', '外貌为空的老陈不算，代码块围栏剥掉', w.eval('ipeCastCards().map(c => c.name).join()'));
        check(w.document.querySelector('#ipe-char-anchors').value.indexOf('【苑无忧】\n外貌: tall woman') === 0, '锚点框显示整理结果，可以直接改');
        check(!/服装|别名/.test(w.document.querySelector('#ipe-char-anchors').value), '副 AI 多写的服装、别名不存');
        check(w.document.querySelector('#ipe-char-anchors').value.indexOf('pale complexion') > 0 && !/skin/i.test(w.document.querySelector('#ipe-char-anchors').value), 'skin 换成 complexion（敏感规则禁词）');
        check(cap.body.messages[0].content.indexOf('complexion') >= 0, '提取提示要求肤色写 complexion');
        const sys = cap.body.messages[0].content;
        check(sys.indexOf('默认男帅女美') >= 0 && sys.indexOf('double eyelids') >= 0 && sys.indexOf('贫穷') >= 0, '提取提示：默认男帅女美、大眼双眼皮、不写脏穷累');
        check(w.document.querySelector('#ipe-cast-status').textContent.indexOf('已锁定 2 个人物') >= 0, '人物锁状态行报锁定人数');
        w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '【苑无忧】\n外貌: tall woman, short silver hair\n服装:\n别名:' } }] }) }; };
        await w.eval('ipeCastScan()');
        const list2 = JSON.parse(st.anchorPresetsJson);
        check(list2.filter(x => x.name === '🔍 苑无忧').length === 1 && list2.find(x => x.name === '🔍 苑无忧').value.indexOf('silver') > 0, '再提取一次：更新同一套预设，不堆新的');
        // 每楼的请求里不再带锁定人物的外貌段
        w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x\n<cast>苑无忧</cast>' } }] }) }; };
        await w.eval('runExtract("正文", "", false, 9)');
        const u = cap.body.messages[1].content;
        check(u.indexOf('short silver hair') < 0 && u.indexOf('【人物锁】') >= 0 && u.indexOf('苑无忧') >= 0, '每楼请求只带人名，外貌不再重复发', u.slice(0, 300));
        check(w.document.querySelector('#ipe-preview-text').value.indexOf('苑无忧: tall woman, short silver hair.') === 0, '贴进提示词的是整理好的那一行');
    }
    console.log('\n【user 叫「你」】正文里 user 被称作「你」也能锁上（2.22.3）');
    {
        const { tavern, cap, api, box, run, st } = await setup();
        tavern.name1 = '小雨';
        st.anchorPresetsJson = JSON.stringify([{ id: 'anchor_1', name: '主角', value: '【苑无忧】\n外貌: tall woman, black hair\n\n【小雨】\n外貌: 18-year-old girl, short black bob, round glasses' }]);
        api('苑无忧 leans toward 小雨.\n<cast>苑无忧, 你</cast>');
        await run();
        const u = cap.body.messages[1].content;
        check(u.indexOf('用第二人称「你」称呼的人就是 user「小雨」') >= 0, '约定里点明「你」就是 user');
        check(u.indexOf('你的输出') < 0, '约定里不再用「你」称呼副 AI，免得和 user 混');
        check(box('ipe-preview-text').indexOf('小雨: 18-year-old girl') > 0, '<cast> 写「你」也认成 user，外貌贴上', box('ipe-preview-text'));
        api('Close-up of 苑无忧.\n<cast>苑无忧, you</cast>');
        await run();
        check(box('ipe-preview-text').indexOf('小雨: ') > 0, '写 you 也认');
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
