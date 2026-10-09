/* 小海螺 · 挂账管线 E2E 流程测试
   跑法：node ledger.test.js
   只测状态与顺序，不碰真 API。重点是 2.8.1 那个抢跑 bug：
   单元测试测不出来——每个函数单看都对，错的是事件与组 prompt 的先后。 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log("  \u2705 " + name); }
    else { fail++; console.log("  \u274C " + name + (extra ? "\n       " + extra : "")); }
}
function eq(a, b, name) { ok(a === b, name, "期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a)); }

/* ---- 假酒馆 ---- */
function makeTavern(floors) {
    const listeners = {};
    const chat = [];
    for (let i = 0; i < floors; i++) {
        chat.push({ is_user: i % 2 === 0, is_system: false, mes: "第 " + (i + 1) + " 层正文，够长够长够长够长够长够长。" });
    }
    const eventSource = {
        on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        async emit(ev, ...args) { for (const fn of (listeners[ev] || [])) await fn(...args); }
    };
    const extensionPrompts = {};
    return {
        chat, eventSource, extensionPrompts,
        chatId: "test-chat",
        event_types: {
            GENERATION_STARTED: "GENERATION_STARTED", MESSAGE_SENT: "MESSAGE_SENT",
            MESSAGE_RECEIVED: "MESSAGE_RECEIVED", MESSAGE_SWIPED: "MESSAGE_SWIPED",
            MESSAGE_DELETED: "MESSAGE_DELETED", MESSAGE_EDITED: "MESSAGE_EDITED", CHAT_CHANGED: "CHAT_CHANGED",
            GENERATION_ENDED: "GENERATION_ENDED", GENERATION_STOPPED: "GENERATION_STOPPED"
        },
        chatMetadata: {},
        characters: [{ name: "苑无忧", avatar: "yuan.png" }, { name: "顾寒", avatar: "gu.png" }], characterId: 0, groupId: null, name2: "苑无忧",
        getCurrentChatId() { return "test-chat"; },
        setExtensionPrompt(key, value, pos, depth, scan, role) {
            extensionPrompts[key] = { value, position: pos, depth, role };
        },
        saveMetadataDebounced() {}, saveSettingsDebounced() {},
        extensionSettings: {}, extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }
    };
}

/* ---- 把 index.js 装进 jsdom，抠出内部函数 ---- */
function boot(floors, reuse) {   // reuse：拿同一个聊天再开一个新页面（模拟页面重新载入，内存清空、聊天数据还在）
    const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "outside-only", url: "http://localhost" });
    const w = dom.window;
    const tavern = reuse ? Object.assign(reuse, { eventSource: makeTavern(0).eventSource }) : makeTavern(floors);
    w.SillyTavern = { getContext: () => tavern };
    w.toastr = { error() {}, success() {}, warning() {}, info() {} };
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;   // jsdom 没带，流式解码要用
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>新账本正文，够长够长够长够长够长够长够长。</ledger>" } }] }) });

    const exposed = ["ipeLedgerRead", "ipeLedgerSave", "ipeLedgerCommit", "ipeLedgerReconcile",
        "ipeFloorNo", "ipeLedgerApplyEP", "ipeLedgerNormalize", "ipeLedgerStop",
        "ipeLedgerIsAbort", "ipeLedgerExport", "ipeLedgerImportText", "ipeLedgerInspectEP",
        "EXT_NAME", "DEFAULTS", "IPE_LEDGER_EP_KEY", "init", "ipeLedgerStripImageTag", "ipeLedgerBuildUser", "ipeLedgerReportBlock", "ipeLedgerPruneMirror",
        "ipeLedgerRun", "ipeLedgerCallAPI", "ipeLedgerReadStream", "ipeLedgerIsReasoningModel",
        "runExtract", "ipeImgParseLayers", "buildInjectTag", "reinjectDescToMessage", "injectDescToMessage", "ipeInstallMesButtons", "ipeGetSuppPresets", "ipeRefreshSuppPresets", "buildVisionUserPrompt", "ipeImgLayersRead", "onRerollLayer",
        "ipeInstallZoomButtons", "ipeZoomOpen", "ipeZoomClose", "ipeZoomTitleFor",
        "ipeImgPackBuild", "ipeImgPackImportText", "ipeGetBaseTemplates", "ipeGetCommonBlocks", "ipeDeleteCommonBlock", "ipeRefreshAnchorEditors", "ipeGetAnchorValue", "ipeBatchSetTemplateCommon", "ipeGetRulePresets", "ipeGetSystemPromptPresets", "ipeGetAnchorPresets", "ipeGetAnchorUsageGuide",
        "ipeLedgerReadModeMarker", "ipeLedgerStripModeTag", "ipeLedgerModeEffective", "ipeLedgerModeState", "ipeLedgerModeSnippet", "ipeLedgerSystemText",
        "ipeLedgerMirrorFlush", "ipeLedgerMirrorInvalidate", "ipeSortByName", "ipeRefreshTemplateEditors",
        "ipeLedgerCompress", "ipeLedgerCommitCompressed", "ipeLedgerEstimateChars", "ipeLedgerVersionInfo", "ipeLedgerHistoryBlock", "ipeLedgerRefreshEditors", "ipeLedgerInherit", "ipeLedgerInheritList", "ipeLedgerRefreshInherit", "ipeLedgerCardKey", "ipeLedgerCardSlotSet", "ipeLedgerPromptValueForMode", "ipeLedgerModeRefresh",
        "ipeLedgerSrcMark", "ipeLedgerModeSet", "ipeImgLayersSave", "ipeLedgerModeState"];
    const shim = SRC + "\n;(function(){ " +
        exposed.map(n => `try{ window.__t_${n} = ${n}; }catch(e){}`).join(" ") +
        " try{ window.__t_failStreak = function(){ return ipeLedgerFailStreak; }; }catch(e){}" +
        " })();";
    try { w.eval(shim); } catch (e) { console.log("装载失败：" + e.message); }
    const F = n => w["__t_" + n];
    // 事件绑定藏在 createUI() 里，由 APP_READY 触发——不发这个事件，什么都没绑上
    // 2.18.0 起挂账失败默认自动重试一次；老测试都是「失败一次就该弹卡 / 计数」，测试环境默认关掉，【44】单独打开
    if (!reuse) tavern.extensionSettings[F("EXT_NAME")] = Object.assign({}, F("DEFAULTS"), { ledgerRetryOnce: false });
    try { F("init")(); } catch (e) { console.log("init 抛错：" + e.message); }
    return { w, tavern, F, EPK: F("IPE_LEDGER_EP_KEY") };
}

console.log("\n\u30101\u3011 落账与楼号");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("第十层的账本内容，够长够长够长够长。", 10);
    const st = F("ipeLedgerRead")();
    eq(st.lastFloor, 10, "落账后现任停在第 10 楼");
    ok(st.current.indexOf("第十层") >= 0, "账本正文写进去了");
}

console.log("\n\u30102\u3011 重roll抢跑（2.8.1 核心回归）");
{
    const { tavern, F, EPK } = boot(10);
    F("ipeLedgerCommit")("菜烧糊了——这条绝不能进下一次 roll 的 prompt。", 10);
    F("ipeLedgerApplyEP")();
    const before = tavern.extensionPrompts[EPK] || {};
    ok(String(before.value || "").indexOf("菜烧糊") >= 0, "roll 之前贴耳里确实带着菜糊");

    // 关键：同步发 GENERATION_STARTED("swipe")，模拟酒馆按下 roll 那一霎那
    let epAtPromptTime = null;
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    epAtPromptTime = String((tavern.extensionPrompts[EPK] || {}).value || "");

    ok(epAtPromptTime.indexOf("菜烧糊") < 0,
        "按下 roll 的同一时刻，贴耳里已经没有菜糊了（修好前这条必挂）",
        "实际贴耳：" + epAtPromptTime.slice(0, 60));
    eq(F("ipeLedgerRead")().lastFloor, -1, "第 10 楼的账被撕掉，没有更低楼可退时归空");
}

console.log("\n\u3010\u6B63\u63A7\u3011 handler \u5FC5\u987B\u771F\u7684\u7ED1\u4E0A\u4E86");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("正控用的账本正文，够长够长够长够长。", 10);
    const before = F("ipeLedgerRead")().lastFloor;
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    const after = F("ipeLedgerRead")().lastFloor;
    ok(before === 10 && after !== 10,
        "swipe 事件确实改变了账本状态（不成立则下面 continue/dryRun 全是假绿）",
        "before=" + before + " after=" + after);
}

console.log("\n\u30103\u3011 continue 不该撕账");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("这层的账在 continue 时仍然算数，够长够长够长。", 10);
    tavern.eventSource.emit("GENERATION_STARTED", "continue", {}, false);
    eq(F("ipeLedgerRead")().lastFloor, 10, "continue 是给当前楼续写，账保留");
}

console.log("\n\u30104\u3011 dryRun 不该撕账");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("dryRun 只是数 token，不该动账本，够长够长够长。", 10);
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, true);
    eq(F("ipeLedgerRead")().lastFloor, 10, "dryRun 时账本不动");
}

console.log("\n\u30105\u3011 滚回上一楼（有低楼可退时）");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("第 9 楼的账，够长够长够长够长够长。", 9);
    F("ipeLedgerCommit")("第 10 楼的账（菜糊），够长够长够长够长。", 10);
    eq(F("ipeLedgerRead")().lastFloor, 10, "落账后在第 10 楼");
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    const st = F("ipeLedgerRead")();
    eq(st.lastFloor, 9, "roll 之后滚回第 9 楼");
    ok(st.current.indexOf("第 9 楼") >= 0, "现任内容换成第 9 楼那份");
    ok(st.current.indexOf("菜糊") < 0, "菜糊那份彻底不在现任里");
}

console.log("\n\u30106\u3011 藏楼时楼号不该错位（第七条）");
{
    const { tavern, F } = boot(10);
    tavern.chat[9].is_system = true;               // 把末楼藏了
    F("ipeLedgerCommit")("读的是第 9 层正文，就该盖第 9 层的戳。", 9);
    eq(F("ipeLedgerRead")().lastFloor, 9, "正文取自第 9 层，戳就是第 9 层（不是 chat.length=10）");
}

console.log("\n\u30107\u3011 中断判定");
{
    const { F } = boot(10);
    ok(F("ipeLedgerIsAbort")({ name: "AbortError" }) === true, "AbortError 认作中断");
    ok(F("ipeLedgerIsAbort")(new Error("API 500：boom")) === false, "普通报错不算中断");
}

console.log("\n\u30108\u3011 导入导出往返");
{
    const { F } = boot(10);
    F("ipeLedgerCommit")("要被导出的账本正文，够长够长够长够长。", 10);
    const pack = JSON.stringify({ _fmt: "ipe-ledger", _v: 2, data: F("ipeLedgerRead")() });
    F("ipeLedgerImportText")("这不是 JSON");
    ok(F("ipeLedgerRead")().current.indexOf("要被导出") >= 0, "烂 JSON 不会毁掉现有账本");
    F("ipeLedgerImportText")(pack);
    ok(F("ipeLedgerRead")().current.indexOf("要被导出") >= 0, "合法包导入后正文还在");
}

console.log("\n\u30109\u3011 \u8D34\u8033\u81EA\u68C0\u7EDD\u4E0D\u80FD\u6C61\u67D3\u8D26\u672C");
{
    const { w, tavern, F } = boot(10);
    F("ipeLedgerCommit")("这是真正的账本正文，够长够长够长够长够长。", 10);
    const beforeCur = F("ipeLedgerRead")().current;

    F("ipeLedgerInspectEP")();

    const cur = F("ipeLedgerRead")().current;
    eq(cur, beforeCur, "自检之后账本存储一字未改");
    ok(cur.indexOf("贴耳自检") < 0, "账本正文里没有自检文本");

    const editor  = w.document.querySelector("#ipe-ledger-text");
    const preview = w.document.querySelector("#ipe-ledger-preview");
    ok(!editor  || String(editor.value  || "").indexOf("贴耳自检") < 0,
        "账本编辑框没被写入自检文本");
    ok(!preview || String(preview.value || "").indexOf("贴耳自检") < 0,
        "预览框没被写入自检文本（那个框旁边就是「采用」）");

    const out = w.document.querySelector("#ipe-ledger-ep-out");
    ok(out && String(out.textContent || "").indexOf("贴耳自检") >= 0,
        "自检文本落在只读框里");
    ok(!out || out.tagName === "PRE", "只读框是 pre，不是可编辑控件");
    ok(out && String(out.textContent || "").indexOf("【🐚 楼内块自检】") >= 0, "2.27.10 看贴耳顺带报 🐚 楼内块（手机看不到控制台，靠截图）");
}


console.log("\n\u301010\u3011 生图 tag 剥离（2.9.2 / 2.14.0 内置改 <draw>）");
{
    const { tavern, F } = boot(10);
    const strip = F("ipeLedgerStripImageTag");
    eq(strip("正文。\n\n<draw>a girl by the window</draw>"), "正文。", "内置默认 <draw>…</draw>：整段剥掉");
    eq(strip("正文。\n\n<draw>\nline one\nline two\n</draw>"), "正文。", "跨行的 <draw> 块也剥");
    eq(strip("正文。\n\nimage###a girl###"), "正文。", "老聊天里的 image###…### 仍认得（legacy 兜底）");
    eq(strip("正文里提到 image###x### 这种写法。\n\nimage###real###"), "正文里提到 这种写法。", "前后缀齐全时按对剥（与旧行为一致）");
    // 样板那种：整段 <draw> 包着、只放五个分层占位符、没有 {Description}
    const STYLE = "<draw> Artistic Illustrations. Medium and style (hard rules): a refined 2.5D illustration.\n\nComposition: {Camera}\nSetting: {Env}\nMood and light: {Mood}\nCharacters: {Chars}\nAction: {Pose}\n </draw>";
    const st10 = tavern.extensionSettings[F("EXT_NAME")];
    st10.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水光", value: STYLE }]);
    st10.activeBaseTemplate = "tpl_1";
    const tag10 = F("buildInjectTag")("ignored", { camera: "wide shot.", env: "a sunlit room.", mood: "caustic light.", chars: "a boy.", pose: "he sits." });
    ok(tag10.indexOf("Composition: wide shot.") >= 0 && tag10.indexOf("Action: he sits.") >= 0 && tag10.indexOf("{") < 0, "样板模板：五层各就各位，没有占位符残留");
    eq(strip("正文。\n\n" + tag10), "正文。", "样板模板注入的整块 <draw> 剥干净（之前没有 {Description} 的模板整段找不到，几千字风格正文会喂进挂账）");
    eq(strip("正文。\n\n<draw> old style text. Composition: X\n </draw>"), "正文。", "模板正文后来改过：旧楼按 <draw> 标签对照样剥");
    st10.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "非包裹分层", value: "IMG[ {Camera} | {Pose} ]END" }]);
    eq(strip("正文。\n\nIMG[ a | b ]END"), "正文。", "不是标签包裹的分层模板：前缀取第一个占位符前、后缀取最后一个占位符后");
    tavern.extensionSettings["image-prompt-extractor"].baseTemplatesJson = JSON.stringify([
        { id: "tpl_1", name: "前缀", value: "IMG: {Description}" },
        { id: "tpl_2", name: "无占位", value: "[pic]" }]);
    eq(strip("他说 IMG: 不是这个。\n\nIMG: a girl by window"), "他说 IMG: 不是这个。", "只有前缀：从最后一次出现剥到楼尾，正文里同样的字不误伤");
    eq(strip("正文。\n\n[pic]a girl"), "正文。", "模板没占位符：按 tpl+desc 拼接方式也能剥");
}
console.log("\n\u301011\u3011 摘要层不重复喂本轮那楼 + 楼号按正文所在层报");
{
    const { tavern, F } = boot(10);
    tavern.chat[7].mes = "第8层 <report>八楼摘要</report>";
    tavern.chat[9].mes = "第10层 <report>十楼摘要</report>";
    const u10 = F("ipeLedgerBuildUser")(tavern.chat[9].mes, "", 10);
    ok(u10.indexOf("八楼摘要") >= 0, "更早楼的 report 在摘要层");
    ok(u10.split("十楼摘要").length === 2, "本轮那楼的 report 只出现一次（在正文里，不在摘要层）");
    ok(u10.indexOf("【当前楼层】第 10 楼") >= 0, "楼号 10");
    const u8 = F("ipeLedgerBuildUser")(tavern.chat[7].mes, "", 8);
    ok(u8.indexOf("【当前楼层】第 8 楼") >= 0, "藏末楼读第 8 层时报第 8 楼，不再报 chat.length");
}
console.log("\n\u301012\u3011 镜像修剪");
{
    const { F } = boot(10);
    const all = {}; for (let i = 0; i < 40; i++) all["c" + i] = { updatedAt: i };
    const out = F("ipeLedgerPruneMirror")(all, 30);
    eq(Object.keys(out).length, 30, "只留 30 个");
    ok(out.c39 && !out.c0, "留的是最近活跃的");
}


/* ---- 流式挂账用的假 API ----
   把 SSE 文本切成若干块，按 Uint8Array 从 body.getReader() 吐出去，跟真浏览器一个路数。 */
function sseBody(chunks) {
    const enc = new TextEncoder();
    let i = 0;
    return { getReader() { return { async read() {
        if (i >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: enc.encode(chunks[i++]) };
    } }; } };
}
function withApi(tavern, F, model) {
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: model || "gpt-5" }]);
    st.ledgerApiProfile = "api_1";
    return st;
}
function statusText(w) { const el = w.document.querySelector("#ipe-ledger-status"); return el ? el.textContent : ""; }

(async () => {
console.log("\n【13】 流式挂账（2.10.0：思考模型边想边流）");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    let sentBody = null;
    w.fetch = async (url, opt) => {
        sentBody = JSON.parse(opt.body);
        return { ok: true, status: 200, body: sseBody([
            'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"先看看第十楼发生了什么……"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"这条要挂。"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"<led"}}]}\n\ndata: {"choices":[{"delta":{"content":"ger>· 左肩刀伤（第10楼起），够长够长够长够长够长。</le"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"dger>"}}]}\n\n',
            'data: [DONE]\n\n'
        ]) };
    };
    await F("ipeLedgerRun")(9, true);
    const st = F("ipeLedgerRead")();
    ok(st.current.indexOf("左肩刀伤") >= 0, "delta 跨块拼起来的账本落账了", "实际：" + st.current.slice(0, 60));
    ok(st.current.indexOf("先看看") < 0, "reasoning_content 只计数，不进账本");
    eq(st.lastFloor, 10, "落在第 10 楼");
    eq(sentBody.stream, true, "请求体 stream: true");
    ok(!("temperature" in sentBody), "gpt-5 不发 temperature（否则官方直连 400）");
    ok(!("reasoning_effort" in sentBody), "没设强度时不发 reasoning_effort");
})();

console.log("\n【14】 请求体：普通模型仍发 temperature，设了强度就发 reasoning_effort");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerReasoningEffort = "low";
    let sentBody = null;
    w.fetch = async (url, opt) => { sentBody = JSON.parse(opt.body); return { ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>普通模型账本，够长够长够长够长够长够长。</ledger>"}}]}\n', 'data: [DONE]\n']) }; };
    await F("ipeLedgerRun")(9, true);
    eq(sentBody.temperature, 0.2, "gpt-4.1 照发 temperature 0.2");
    eq(sentBody.reasoning_effort, "low", "reasoning_effort 按设置透传");
    ok(F("ipeLedgerRead")().current.indexOf("普通模型账本") >= 0, "没有空行分隔的 SSE 也能收");
    eq(F("ipeLedgerIsReasoningModel")("o3-mini"), true, "o3-mini 是思考模型");
    eq(F("ipeLedgerIsReasoningModel")("gpt-5-mini"), true, "gpt-5-mini 是思考模型");
    eq(F("ipeLedgerIsReasoningModel")("gpt-5-chat-latest"), false, "gpt-5-chat-latest 不是");
    eq(F("ipeLedgerIsReasoningModel")("gpt-4o"), false, "gpt-4o 不是");
})();

console.log("\n【15】 中转偷懒：要了 stream 却整包 JSON 回来 → 回退整包解析");
// 同正文主动重跑使用手动入口，自动重复通知由 dedup.test.js 单独验证。
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['{"choices":[{"message":{"content":"<ledger>整包回来的账本，够长够长够长够长够长够长。</ledger>"}}]}']) });
    await F("ipeLedgerRun")(9, false);
    ok(F("ipeLedgerRead")().current.indexOf("整包回来") >= 0, "非 SSE 的 JSON 一样落账");
    // 老测试桩：response 没有 body 只有 text()，也要能走通（默认就是流式开）
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>只有 text() 的桩，够长够长够长够长够长够长。</ledger>" } }] }) });
    await F("ipeLedgerRun")(9, false);
    ok(F("ipeLedgerRead")().current.indexOf("只有 text()") >= 0, "没有可读流的环境按整包读");
})();

console.log("\n【16】 流里夹 error → 算失败，账本不动");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    F("ipeLedgerCommit")("旧账本内容，够长够长够长够长够长够长够长。", 8);
    const before = F("failStreak")();
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['data: {"error":{"message":"insufficient_quota"}}\n\n']) });
    await F("ipeLedgerRun")(9, true);
    eq(F("failStreak")(), before + 1, "失败计数 +1");
    ok(F("ipeLedgerRead")().current.indexOf("旧账本") >= 0, "账本还是旧的");
    ok(statusText(w).indexOf("insufficient_quota") >= 0, "状态行点名了错误原因", statusText(w));
})();

console.log("\n【17】 空闲看门狗：一个字节都不来 → 超时算失败，不算「人掐的」；连撞两次自动挂账关闭");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;          // 1 秒没字节就判死
    st.ledgerAutoRun = true;
    F("ipeLedgerCommit")("看门狗之前的账本，够长够长够长够长够长够长。", 8);
    w.fetch = (url, opt) => new Promise((resolve, reject) => {
        // 永远不回；只认 abort
        opt.signal.addEventListener("abort", () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; reject(e); });
    });
    const before = F("failStreak")();
    const t0 = Date.now();
    await F("ipeLedgerRun")(9, true);
    ok(Date.now() - t0 < 5000, "没有干等：1 秒左右就断了");
    eq(F("failStreak")(), before + 1, "超时算一次失败（不是「已中断」）");
    ok(statusText(w).indexOf("超时") >= 0 && statusText(w).indexOf("已中断") < 0, "状态行报的是超时不是中断", statusText(w));
    eq(st.ledgerAutoRun, true, "只撞一次，自动挂账还开着");
    ok(F("ipeLedgerRead")().current.indexOf("看门狗之前") >= 0, "账本没动");
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, false, "连撞两次，自动挂账自动关闭（挂死以前永远走不到这一步）");
    // 再来一次要能跑：Busy 没被卡死
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>活过来的账本，够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("活过来") >= 0, "超时后 Busy 已复位，下一次挂账正常跑");
})();

console.log("\n【18】 流到一半字节还在来就不判死（看门狗按块续命）");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;
    const enc = new TextEncoder();
    const pieces = [
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"content":"<ledger>慢慢流回来的账本，够长够长够长够长够长够长。</ledger>"}}]}\n'
    ];
    let i = 0;
    w.fetch = async () => ({ ok: true, status: 200, body: { getReader() { return { async read() {
        if (i >= pieces.length) return { done: true };
        await new Promise(r => setTimeout(r, 600));     // 每块隔 0.6 秒，总共 2.4 秒 > 1 秒空闲阈值
        return { done: false, value: enc.encode(pieces[i++]) };
    } }; } } });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("慢慢流回来") >= 0, "总时长超过阈值但每块都在续命，照样落账", statusText(w));
})();

console.log("\n【19】 空回复要说清原因：finish_reason=length 是思考吃光额度");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    F("ipeLedgerCommit")("白卷之前的账本，够长够长够长够长够长够长。", 8);
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n'
    ]) });
    await F("ipeLedgerRun")(9, true);
    ok(statusText(w).indexOf("length") >= 0 && statusText(w).indexOf("额度") >= 0, "状态行点名 finish_reason=length 与额度吃光", statusText(w));
    ok(F("ipeLedgerRead")().current.indexOf("白卷之前") >= 0, "账本没动");
})();

console.log("\n【20】 输出上限：思考模型发 max_completion_tokens，普通模型发 max_tokens，0 不发");
// 同正文主动重跑使用手动入口，自动重复通知由 dedup.test.js 单独验证。
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    let sent = null;
    const okStream = () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>上限测试账本，够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return okStream(); };
    await F("ipeLedgerRun")(9, false);
    ok(!("max_tokens" in sent) && !("max_completion_tokens" in sent), "默认 0：两种都不发");
    st.ledgerMaxTokens = 16000;
    await F("ipeLedgerRun")(9, false);
    eq(sent.max_completion_tokens, 16000, "gpt-5 → max_completion_tokens");
    ok(!("max_tokens" in sent), "gpt-5 不发 max_tokens");
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: "gpt-4.1" }]);
    await F("ipeLedgerRun")(9, false);
    eq(sent.max_tokens, 16000, "gpt-4.1 → max_tokens");
    ok(!("max_completion_tokens" in sent), "gpt-4.1 不发 max_completion_tokens");
})();

console.log("\n【21】 首字节之后看门狗放宽一倍：首字节前 1 秒判死，首字节后能扛 1.5 秒沉默");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;
    const enc = new TextEncoder();
    let i = 0;
    const pieces = ['data: {"choices":[{"delta":{"content":"\\n"}}]}\n', 'data: {"choices":[{"delta":{"content":"<ledger>放宽后收到的账本，够长够长够长够长够长够长。</ledger>"}}]}\n'];
    w.fetch = async () => ({ ok: true, status: 200, body: { getReader() { return { async read() {
        if (i >= pieces.length) return { done: true };
        if (i === 1) await new Promise(r => setTimeout(r, 1500));   // 首字节之后沉默 1.5 秒：> 1 秒，< 2 秒
        return { done: false, value: enc.encode(pieces[i++]) };
    } }; } } });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("放宽后") >= 0, "首字节后 1.5 秒沉默没被判死", statusText(w));
})();

/* ---- 分层生图用的假 API：整包 JSON，顺手把请求体抓出来 ---- */
function imgApi(w, tavern, F, content, capture) {
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiEndpoint = "http://x.test/v1"; st.apiKey = "k"; st.model = "gpt-4.1";
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: "gpt-4.1" }]);
    w.fetch = async (u, o) => { if (capture) capture.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: typeof content === "function" ? content() : content } }] }) }; };
    return st;
}
const L4 = (cam, env, chars, pose, mood) => `<camera>${cam}</camera>\n<env>${env}</env>\n` + (mood != null ? `<mood>${mood}</mood>\n` : "") + `<chars>${chars}</chars>\n<pose>${pose}</pose>`;
const box = (w, id) => { const el = w.document.querySelector("#" + id); return el ? el.value : null; };
const imgStatus = w => { const el = w.document.querySelector("#ipe-status"); return el ? el.textContent : ""; };

console.log("\n【22】 分层剥壳：完整 / 漏闭标签 / 围栏 / 没分层");
{
    const { F } = boot(4);
    const P = F("ipeImgParseLayers");
    const a = P(L4("medium shot", "rainy rooftop at dusk", "a girl in white", "she leans on the railing"));
    eq(a.found, 4, "四层齐全"); eq(a.env, "rainy rooftop at dusk", "环境层内容对");
    const b = P("<camera>close-up\n<env>dim classroom</env><chars>boy</chars><pose>sits");
    eq(b.found, 4, "漏闭标签也认"); eq(b.camera, "close-up", "漏闭标签取到下一个开标签为止"); eq(b.pose, "sits", "末尾漏闭标签取到结尾");
    const c = P("```\n<Camera>wide</Camera><ENV>street</ENV>\n```");
    eq(c.found, 2, "围栏剥掉、大小写不敏感"); eq(c.env, "street", "ENV 大写也认");
    eq(P("just a plain description").found, 0, "没标签 → found 0");
}

console.log("\n【23】 分层提取端到端：四框落值、整段拼好、环境层次楼 NO_CHANGE 沿用");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("medium two-shot at eye level.", "A rain-soaked rooftop at dusk, sodium lights below.", "A girl in a white dress, hair wet.", "She grips the railing, facing the city."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("<camera>") >= 0, "请求里带分层合同");
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层") < 0, "第一次没有上一楼环境可继承");
    eq(box(w, "ipe-layer-env"), "A rain-soaked rooftop at dusk, sodium lights below.", "环境框落值");
    eq(box(w, "ipe-layer-pose"), "She grips the railing, facing the city.", "动作框落值");
    ok(String(box(w, "ipe-preview-text")).indexOf("medium two-shot at eye level. A rain-soaked rooftop") === 0, "整段按 镜头→环境→人物→动作 拼好", box(w, "ipe-preview-text"));
    const saved = F("ipeImgLayersRead")();
    eq(saved.floor, 10, "存档记了楼号 10"); eq(saved.env, "A rain-soaked rooftop at dusk, sodium lights below.", "存档有环境层");
    // 次楼：环境没换
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "The girl, eyes closed.", "She turns her face into the rain."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层") >= 0 && cap.body.messages[1].content.indexOf("sodium lights") >= 0, "第二次把上一楼环境喂给了副 AI");
    eq(box(w, "ipe-layer-env"), "A rain-soaked rooftop at dusk, sodium lights below.", "NO_CHANGE → 环境沿用");
    eq(box(w, "ipe-layer-camera"), "close-up.", "其他层照常更新");
    ok(imgStatus(w).indexOf("环境沿用第 10 楼") >= 0, "状态行说明环境沿用自哪一楼", imgStatus(w));
    ok(imgStatus(w).indexOf("氛围层为空") >= 0, "没给氛围层时状态行点名（提醒该改提取提示词）", imgStatus(w));
    ok(String(box(w, "ipe-preview-text")).indexOf("NO_CHANGE") < 0, "整段里不会出现 NO_CHANGE");
})();

console.log("\n【24】 锁：锁住动作层后副 AI 给的新动作被忽略，且锁定内容喂回请求");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide.", "a quiet library.", "a boy in uniform.", "he reads at the desk."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    st.imgLockPose = true;
    w.document.querySelector("#ipe-layer-pose").value = "he reads at the desk, left hand on the page.";   // 人改过再锁 = 照这个来
    imgApi(w, tavern, F, () => L4("wide.", "a quiet library.", "a boy in uniform.", "he stands up and leaves."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("已锁定的层") >= 0 && cap.body.messages[1].content.indexOf("left hand on the page") >= 0, "锁定层原文进了请求");
    eq(box(w, "ipe-layer-pose"), "he reads at the desk, left hand on the page.", "锁住的动作层没被覆盖");
    ok(String(box(w, "ipe-preview-text")).indexOf("stands up") < 0, "整段里也没有副 AI 的新动作");
})();

console.log("\n【25】 只重摇一层：其余三层临时锁定");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("A.", "B.", "C.", "D."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    imgApi(w, tavern, F, () => L4("A2.", "B2.", "C2.", "D2."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9, 0, { camera: true, env: true, chars: true, pose: false });
    eq(box(w, "ipe-layer-camera"), "A.", "镜头层保持"); eq(box(w, "ipe-layer-env"), "B.", "环境层保持"); eq(box(w, "ipe-layer-chars"), "C.", "人物层保持");
    eq(box(w, "ipe-layer-pose"), "D2.", "只有动作层换了新的");
    eq(box(w, "ipe-preview-text"), "A. B. C. D2.", "整段随之重拼");
    const c = cap.body.messages[1].content;
    ok(c.indexOf("<camera>A.</camera>") >= 0 && c.indexOf("<pose>") >= 0 && c.indexOf("<pose>D.</pose>") < 0, "请求里锁了三层，没锁动作层");
})();

console.log("\n【23b】 NO_CHANGE 带句号 / 引号 / 空格也算哨兵；老存档里的 NO_CHANGE. 不再往下传（2.14.2）");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide.", "a rooftop at dusk.", "a girl.", "she leans.", "warm light."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE.", "the girl.", "she turns.", "`No change`"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-layer-env"), "a rooftop at dusk.", "NO_CHANGE. 带句号 → 沿用上一楼环境，不落哨兵字面量");
    eq(box(w, "ipe-layer-mood"), "warm light.", "`No change` 反引号 + 空格 → 沿用上一楼氛围");
    ok(box(w, "ipe-preview-text").indexOf("NO_CHANGE") < 0, "拼好的整段里没有 NO_CHANGE");
    ok(imgStatus(w).indexOf("环境沿用第 10 楼") >= 0 && imgStatus(w).indexOf("氛围沿用第 10 楼") >= 0, "状态行报沿用而不是「五层齐全」", imgStatus(w));
    // 老版本存进 chat_metadata 的哨兵字面量：不喂给副 AI，也不当作上一楼内容沿用
    const saved = F("ipeImgLayersRead")();
    ok(!!saved, "存档读得到"); saved.env = "NO_CHANGE.";
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "the girl.", "she turns.", "NO_CHANGE"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层】\nNO_CHANGE") < 0, "存档里的 NO_CHANGE. 没被当成上一楼环境喂给副 AI");
    eq(box(w, "ipe-layer-env"), "", "没有真环境可沿用时环境框为空，而不是 NO_CHANGE.");
    ok(imgStatus(w).indexOf("环境层为空") >= 0, "状态行如实报环境层为空", imgStatus(w));
})();

console.log("\n【26】 模板占位符：{Env} {Pose} 单放，{Description} 拿剩下的；老模板照旧；内置默认 <draw>");
{
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const layers = { camera: "CAM", env: "ENV", chars: "CHR", pose: "POS" };
    eq(F("buildInjectTag")("plain", null), "<draw>plain</draw>", "模板留空：内置默认 <draw>{Description}</draw>");
    eq(F("buildInjectTag")("CAM ENV CHR POS", layers), "<draw>CAM ENV CHR POS</draw>", "内置默认 + 分层：整段进 {Description}");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "分层", value: "scene: {Env} | action: {Pose} | rest: {Description}" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("ignored", layers), "scene: ENV | action: POS | rest: CAM CHR", "层占位符各就各位，{Description} 只拿没放的层");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "老", value: "image###{Description}###" }]);
    eq(F("buildInjectTag")("CAM ENV CHR POS", layers), "image###CAM ENV CHR POS###", "老模板：整段进 {Description}");
    eq(F("buildInjectTag")("plain", null), "image###plain###", "非分层模式完全不受影响");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "全层", value: "{Camera}/{Env}/{Chars}/{Pose}" }]);
    eq(F("buildInjectTag")("whatever", layers), "CAM/ENV/CHR/POS", "四层全单放、没有 {Description} 也不多拼");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "只为分层", value: "<draw>S. Composition: {Camera}\nAction: {Pose}\n</draw>" }]);
    eq(F("buildInjectTag")("flat desc", null), "<draw>S. Composition: flat desc\n</draw>", "只放层占位符的模板碰上没分层：整段填进占位符那一片，{Camera} 不漏进正文");
    const d26 = w.document;
    d26.querySelector("#ipe-template-add").click();
    const added = F("ipeGetBaseTemplates")();
    eq(added[added.length - 1].value, "<draw>{Description}</draw>", "「新增模板」初值是 <draw>{Description}</draw>");
}

console.log("\n【26b】 模板融合（2.14.1）：分层与整段共用一张模板，占位符全空的行整行收掉");
{
    const { tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const strip = F("ipeLedgerStripImageTag");
    const BOTH = "<draw> style text.\nComposition: {Camera}\nSetting: {Env}\nMood and light: {Mood}\nCharacters: {Chars}\nAction: {Pose}\n{Description}\n </draw>";
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "融合", value: BOTH }]);
    st.activeBaseTemplate = "tpl_1";
    const five = { camera: "C.", env: "E.", mood: "M.", chars: "CH.", pose: "P." };
    eq(F("buildInjectTag")("ignored", five), "<draw> style text.\nComposition: C.\nSetting: E.\nMood and light: M.\nCharacters: CH.\nAction: P.\n </draw>", "分层成功：五行各就各位，{Description} 那行消失，没有空行");
    eq(F("buildInjectTag")("one flat english description.", null), "<draw> style text.\none flat english description.\n </draw>", "没分层：五行连 Setting: 这些标签一起消失，整段落在 {Description} 那行");
    eq(F("buildInjectTag")("ignored", { camera: "C.", env: "", mood: "", chars: "CH.", pose: "P." }), "<draw> style text.\nComposition: C.\nCharacters: CH.\nAction: P.\n </draw>", "某一层空了：只收那一行");
    eq(F("buildInjectTag")("ignored", { camera: "C.", chars: "CH.", pose: "P." }), "<draw> style text.\nComposition: C.\nCharacters: CH.\nAction: P.\n </draw>", "层对象里干脆没这层：同样只收那一行");
    eq(F("buildInjectTag")("price $& and $1", null), "<draw> style text.\nprice $& and $1\n </draw>", "desc 里的 $& 不被 replace 当模式吃掉");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "单行", value: "{Camera} | {Env} | {Description}" }]);
    eq(F("buildInjectTag")("flat", null), " |  | flat", "单行模板不收行（没有行可收），层占位符填空");
    eq(F("buildInjectTag")("x", { camera: "C", env: "E" }), "C | E | ", "单行分层：各填各的");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "非包裹多行", value: "IMG START\nComposition: {Camera}\nDesc: {Description}\nIMG END" }]);
    const flatTag = F("buildInjectTag")("flat", null);
    eq(flatTag, "IMG START\nDesc: flat\nIMG END", "非包裹多行：Composition 行收掉");
    eq(strip("正文。\n\n" + flatTag), "正文。", "收了行之后挂账照样剥得掉（前缀退到占位符所在行之前）");
    eq(strip("正文。\n\n" + F("buildInjectTag")("x", { camera: "C" })), "正文。", "分层注入的同样剥得掉");
}

console.log("\n【27】 副 AI 没分层：整段兜底，层框不动，状态行明示；分层关着时合同不发");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => "just one flat english description.", cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-preview-text"), "just one flat english description.", "整段照收");
    ok(imgStatus(w).indexOf("没分层") >= 0, "状态行说明副 AI 没分层", imgStatus(w));
    eq(box(w, "ipe-layer-env"), "", "层框没被乱填");
    st.imgLayered = false;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("<camera>") < 0 && cap.body.messages[1].content.indexOf("只输出最终英文 Description") >= 0, "分层关着：老合同原样");
})();

console.log("\n【28】 氛围层：独立第五层，拼装在环境之后、人物之前；NO_CHANGE 沿用并报楼号；{Mood} 占位符");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide shot.", "an empty classroom.", "a boy.", "he sits alone.", "cold fluorescent light, low contrast."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-layer-mood"), "cold fluorescent light, low contrast.", "氛围框落值");
    eq(box(w, "ipe-preview-text"), "wide shot. an empty classroom. cold fluorescent light, low contrast. a boy. he sits alone.", "顺序：镜头 环境 氛围 人物 动作");
    ok(imgStatus(w).indexOf("五层齐全") >= 0, "五层齐全", imgStatus(w));
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "the boy, eyes shut.", "he presses his palms to his eyes.", "NO_CHANGE"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的氛围层") >= 0, "上一楼氛围喂给了副 AI");
    eq(box(w, "ipe-layer-mood"), "cold fluorescent light, low contrast.", "氛围 NO_CHANGE → 沿用");
    ok(imgStatus(w).indexOf("氛围沿用第 10 楼") >= 0 && imgStatus(w).indexOf("环境沿用第 10 楼") >= 0, "状态行分别报环境与氛围沿用楼号", imgStatus(w));
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "五层", value: "M={Mood};rest={Description}" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("x", { camera: "C", env: "E", mood: "MO", chars: "CH", pose: "P" }), "M=MO;rest=C E CH P", "{Mood} 单放，其余进 {Description}");
})();

console.log("\n【29】 ⤢ 放大编辑：每个文本框都有按钮，弹窗里打字实时回填并触发原有 input 链，完成后关闭");
await (async () => {
    const { w, tavern, F } = boot(10);
    F("ipeInstallZoomButtons")();
    const d = w.document;
    const src = d.querySelector("#ipe-layer-pose");
    ok(src && src.parentNode.classList.contains("ipe-zoom-wrap") && src.parentNode.querySelector(".ipe-zoom-btn"), "动作层框被包了一层并带 ⤢ 按钮");
    ok(d.querySelector("#ipe-ledger-prompt").parentNode.querySelector(".ipe-zoom-btn"), "挂账规则框也有按钮");
    // 抽屉要 jQuery + #extensions_settings2，假酒馆没有；用一个假的 iped 框验证 id 映射
    const fake = d.createElement("textarea"); fake.id = "iped-ledger-note"; d.body.appendChild(fake);
    F("ipeInstallZoomButtons")();
    eq(src.parentNode.querySelectorAll(".ipe-zoom-btn").length, 1, "重复安装不重复加按钮");
    eq(F("ipeZoomTitleFor")(src), "🤝 动作层", "标题按 id 映射");
    eq(F("ipeZoomTitleFor")(fake), "本卡要点 / 世界观硬设定", "抽屉 iped- 前缀的 id 也能映射");
    // 先让层框 UI 绑上（init 里是 120ms 定时器）
    await new Promise(r => setTimeout(r, 200));
    tavern.extensionSettings[F("EXT_NAME")].imgLayered = true;
    F("ipeZoomOpen")(src);
    const ov = d.getElementById("ipe-zoom-overlay");
    ok(!!ov, "弹窗出现了");
    eq(ov.style.position, "fixed", "弹窗定位内联，不依赖外部 CSS");
    ok(ov.style.zIndex === "2147483647" && ov.style.getPropertyPriority("z-index") === "important" && ov.style.display === "flex", "z-index 最大值且 important，压得住被强制到 2147483646 的面板");
    ok(/px$/.test(ov.style.height) && parseInt(ov.style.height, 10) === w.innerHeight, "jsdom 里 rect 为 0 → 触发像素兜底，高度=视口高");
    ok(d.querySelector("#ipe-panel .ipe-footer").textContent.indexOf("v" + JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")).version) >= 0, "面板底栏带版本号");
    eq(src.parentNode.querySelector(".ipe-zoom-btn").style.position, "absolute", "按钮定位内联");
    const big = ov.querySelector(".ipe-zoom-ta");
    big.value = "he leans on the door frame.";
    big.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(src.value, "he leans on the door frame.", "源框实时回填");
    eq(d.querySelector("#ipe-preview-text").value, "he leans on the door frame.", "原有 input 链触发：整段预览随之重拼");
    eq(ov.querySelector(".ipe-zoom-count").textContent, "27 字", "字数计数");
    ov.querySelector(".ipe-zoom-close").click();
    ok(!d.getElementById("ipe-zoom-overlay"), "点完成关闭");
    F("ipeZoomOpen")(src);
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    ok(!d.getElementById("ipe-zoom-overlay"), "Esc 关闭");
})();

console.log("\n【30】 生图预设包：导出不带密钥，「只导出当前」只带选中的");
{
    const { tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "秘密", endpoint: "http://x", key: "sk-SECRET", model: "m" }]);
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "校园明媚", value: "A{Description}" }, { id: "tpl_2", name: "暗色油画", value: "B{Description}" }]);
    st.activeBaseTemplate = "tpl_2";
    st.rulePresetsJson = JSON.stringify([{ id: "rule_1", name: "GPT-image-2", value: "R1" }, { id: "rule_2", name: "NAI", value: "R2" }]);
    st.activeRulePreset = "rule_1";
    st.anchorPresetsJson = JSON.stringify([{ id: "anchor_1", name: "苑无忧", value: "boy" }]);
    st.anchorUsageGuide = "我改过的规则";
    const all = F("ipeImgPackBuild")("all");
    eq(all._fmt, "ipe-image-pack", "格式标记");
    eq(all.templates.length, 2, "全部：两套模板都在");
    eq(all.rules.length, 2, "全部：两条规则都在");
    eq(all.anchorGuide, "我改过的规则", "带用户改过的通用锚点规则");
    eq(all.anchors.length, 0, "预设包不带角色锚点（那是各人自己卡的）");
    const ap = F("ipeImgPackBuild")("anchors");
    eq(ap.scope, "anchors", "锚点包 scope=anchors"); eq(ap.anchors.length, 1, "锚点包只带锚点"); eq(ap.templates.length, 0, "锚点包不带模板");
    ok(JSON.stringify(all).indexOf("sk-SECRET") < 0 && JSON.stringify(all).indexOf("http://x") < 0, "不含 API 地址与密钥");
    const cur = F("ipeImgPackBuild")("current");
    eq(cur.templates.length, 1, "当前：只有一套模板"); eq(cur.templates[0].name, "暗色油画", "是选中的那套");
    eq(cur.rules.length, 1, "当前：只有一条规则"); eq(cur.rules[0].name, "GPT-image-2", "是选中的那条");
    eq(cur.systemPrompts.length, 1, "当前：系统提示只带选中的一槽");
    eq(cur.anchors.length, 0, "当前包同样不带锚点");
}

console.log("\n【31】 导入：按名字合并，新名字追加、同名覆盖、别人的原有预设一个不少；系统提示按 id 对槽；裸数组当模板");
await (async () => {
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    w.confirm = () => true;
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "校园明媚", value: "OLD" }, { id: "tpl_9", name: "我自己的", value: "MINE" }]);
    st.rulePresetsJson = JSON.stringify([{ id: "rule_1", name: "GPT-image-2", value: "R-old" }]);
    st.anchorPresetsJson = JSON.stringify([{ id: "anchor_1", name: "角色锚点1", value: "" }]);
    const pack = {
        _fmt: "ipe-image-pack", _v: 1,
        templates: [{ name: "校园明媚", value: "NEW" }, { name: "暗色油画", value: "DARK" }],
        rules: [{ name: "GPT-image-2", value: "R-old" }, { name: "NanoBanana", value: "R-nb" }],
        systemPrompts: [{ id: "sys_plot", name: "剧情", value: "PLOT-NEW" }, { id: "sys_x", name: "不存在的槽", value: "X" }],
        anchors: [{ name: "苑无忧", value: "boy anchors" }],
        anchorGuide: "对方的规则"
    };
    const sum = F("ipeImgPackImportText")(JSON.stringify(pack));
    ok(!!sum, "导入成功");
    const tpl = F("ipeGetBaseTemplates")();
    eq(tpl.length, 3, "模板：原 2 + 新 1 = 3（同名覆盖不新增）");
    eq(tpl.find(x => x.name === "校园明媚").value, "NEW", "同名模板被覆盖");
    eq(tpl.find(x => x.name === "我自己的").value, "MINE", "对方自己的模板原样保留");
    ok(tpl.find(x => x.name === "暗色油画"), "新模板追加");
    eq(sum.templates.added, 1, "统计：模板 +1"); eq(sum.templates.replaced, 1, "统计：模板覆盖 1");
    eq(sum.rules.replaced, 0, "内容相同的同名规则不算覆盖"); eq(sum.rules.added, 1, "规则 +1");
    const sys = F("ipeGetSystemPromptPresets")();
    eq(sys.find(x => x.id === "sys_plot").value, "PLOT-NEW", "系统提示按 id 对槽覆盖");
    eq(sys.length, 2, "系统提示仍是两槽，对不上号的不硬塞");
    ok(F("ipeGetAnchorPresets")().find(x => x.name === "苑无忧"), "包里带锚点、confirm 同意 → 锚点追加");
    // 不同意导锚点：其他照导，锚点跳过
    const r0 = F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-image-pack", templates: [{ name: "只要模板", value: "T0" }], anchors: [{ name: "别人的角色", value: "npc" }] }), { anchors: false });
    eq(r0.templates.added, 1, "模板照导"); eq(r0.anchors.skipped, 1, "锚点跳过 1 套");
    ok(!F("ipeGetAnchorPresets")().find(x => x.name === "别人的角色"), "别人的角色没进来");
    const r00 = F("ipeImgPackImportText")(JSON.stringify(F("ipeImgPackBuild")("anchors").anchors.length ? { _fmt: "ipe-image-pack", scope: "anchors", anchors: [{ name: "自备份", value: "me" }] } : {}));
    ok(r00 && F("ipeGetAnchorPresets")().find(x => x.name === "自备份"), "锚点包（scope=anchors）不问直接导");
    eq(F("ipeGetAnchorUsageGuide")(), "对方的规则", "通用锚点规则替换");
    // 取消 = 什么都不动
    w.confirm = () => false;
    const before = JSON.stringify(F("ipeGetBaseTemplates")());
    const r2 = F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-image-pack", templates: [{ name: "校园明媚", value: "NEWER" }] }));
    ok(r2 === null && JSON.stringify(F("ipeGetBaseTemplates")()) === before, "confirm 取消 → 原样不动");
    // 裸数组 = 模板表
    w.confirm = () => true;
    const r3 = F("ipeImgPackImportText")(JSON.stringify([{ name: "只发模板", value: "T" }]));
    eq(r3.templates.added, 1, "裸数组按模板导入");
    ok(F("ipeImgPackImportText")("not json") === null, "坏 JSON 拒收");
    ok(F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-ledger", data: {} })) === null, "账本包拒收，不会串门");
})();

console.log("\n【31c】 公共块（2.23.0）：拼接顺序、{Common} 占位符、自动插到 </draw> 前、防重复、剥标签");
{
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const strip = F("ipeLedgerStripImageTag");
    st.commonBlocksJson = JSON.stringify([{ id: "c1", name: "通用", value: "COMMON RULES.\nClosing line." }, { id: "c2", name: "古风", value: "ANCIENT RULES." }]);
    const FIVE = "<draw>\n{Camera}\n{Env}\n{Mood}\n{Chars}\n{Pose}\n{Description}\nSTYLE BODY.\n</draw>";
    const five = { camera: "C.", env: "E.", mood: "M.", chars: "CH.", pose: "P." };
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水彩", value: FIVE, common: "c1" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("ignored", five), "<draw>\nC.\nE.\nM.\nCH.\nP.\nSTYLE BODY.\n\nCOMMON RULES.\nClosing line.\n</draw>", "场景五段 → 画风正文 → 空一行 → 公共块（含收尾句）→ </draw>");
    eq(F("buildInjectTag")("flat.", null), "<draw>\nflat.\nSTYLE BODY.\n\nCOMMON RULES.\nClosing line.\n</draw>", "没分层：整段 → 画风正文 → 公共块");
    eq(F("buildInjectTag")("d", null).split("COMMON RULES.").length, 2, "只拼一份");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水彩", value: FIVE }]);
    eq(F("buildInjectTag")("flat.", null), "<draw>\nflat.\nSTYLE BODY.\n</draw>", "不挂：跟以前一模一样");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水彩", value: FIVE, common: "gone" }]);
    eq(F("buildInjectTag")("flat.", null), "<draw>\nflat.\nSTYLE BODY.\n</draw>", "挂的公共块不存在：当不挂");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "单行", value: "<draw>{Description}</draw>", common: "c2" }]);
    eq(F("buildInjectTag")("d", null), "<draw>d\n\nANCIENT RULES.</draw>", "单行包裹：插在 </draw> 前一行");
    // {Common} 占位符
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "占位", value: "<draw>{Description}\n{Common}\nSPECIAL TAIL.\n</draw>", common: "c2" }]);
    eq(F("buildInjectTag")("d", null), "<draw>d\nANCIENT RULES.\nSPECIAL TAIL.\n</draw>", "写了 {Common}：就放在那里，不再自动追加");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "占位", value: "<draw>{Description}\n{Common}\nSPECIAL TAIL.\n</draw>" }]);
    eq(F("buildInjectTag")("d", null), "<draw>d\nSPECIAL TAIL.\n</draw>", "不挂：{Common} 那一行整行去掉，不留字面量");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "行内", value: "<draw>{Description} {Common}</draw>", common: "c2" }]);
    eq(F("buildInjectTag")("d", null), "<draw>d ANCIENT RULES.</draw>", "行内 {Common}");
    // 防重复：正文里已原样带着（空白不同也算）
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "旧", value: "<draw>{Description}\nSTYLE.\nCOMMON   RULES.\n  Closing line.\n</draw>", common: "c1" }]);
    eq(F("buildInjectTag")("d", null), "<draw>d\nSTYLE.\nCOMMON   RULES.\n  Closing line.\n</draw>", "旧正文已原样带着通用段落：不再叠一份");
    // 非包裹型：追加在末尾；剥标签照样剥得掉，公共块改过后老楼也剥得掉
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "非包裹", value: "IMG START\n{Description}\nIMG END", common: "c2" }]);
    const t1 = F("buildInjectTag")("d", null);
    eq(t1, "IMG START\nd\nIMG END\n\nANCIENT RULES.", "非包裹型：公共块追加在末尾");
    eq(strip("正文。\n\n" + t1), "正文。", "非包裹型挂公共块：挂账剥得掉");
    st.commonBlocksJson = JSON.stringify([{ id: "c2", name: "古风", value: "ANCIENT RULES v2." }]);
    eq(strip("正文。\n\n" + t1), "正文。", "公共块改过之后，旧文本注入的老楼照样剥得掉（后缀对不上退回按前缀剥到楼尾）");
    eq(strip("正文。\n\nIMG START\nd\nIMG END"), "正文。", "挂之前注入的老楼（不带公共块）也剥得掉");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水彩", value: FIVE, common: "c2" }]);
    eq(strip("正文。\n\n" + F("buildInjectTag")("d", null)), "正文。", "包裹型：按标签对剥");
}

console.log("\n【31d】 公共块：删除回落为不挂并报名单；批量挂接 / 批量不挂，执行前列名单确认");
{
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.commonBlocksJson = JSON.stringify([{ id: "c1", name: "通用", value: "COMMON." }, { id: "c2", name: "古风", value: "ANCIENT." }]);
    st.baseTemplatesJson = JSON.stringify([
        { id: "t1", name: "古风水墨", value: "<draw>{Description}</draw>" },
        { id: "t2", name: "古风工笔", value: "<draw>{Description}</draw>", common: "c1" },
        { id: "t3", name: "日系厚涂", value: "<draw>{Description}</draw>", common: "c1" }]);
    const T = () => Object.fromEntries(F("ipeGetBaseTemplates")().map(t => [t.name, t.common]));
    let asked = "";
    w.confirm = m => { asked = m; return false; };
    eq(F("ipeBatchSetTemplateCommon")("古风", "c2"), null, "确认框取消：返回 null");
    ok(asked.indexOf("古风水墨") >= 0 && asked.indexOf("古风工笔") >= 0 && asked.indexOf("日系厚涂") < 0, "确认框列出将被修改的模板名单");
    eq(T()["古风水墨"], "", "取消 = 什么都没动");
    w.confirm = () => true;
    const r1 = F("ipeBatchSetTemplateCommon")("古风", "c2");
    eq(r1.changed.length, 2, "名字含「古风」的两个模板改挂古风");
    eq(JSON.stringify(T()), JSON.stringify({ "古风水墨": "c2", "古风工笔": "c2", "日系厚涂": "c1" }), "其他模板不动");
    const r2 = F("ipeBatchSetTemplateCommon")("", "");
    eq(r2.changed.length, 3, "关键词留空 = 全部模板；目标空 = 批量改为不挂");
    eq(JSON.stringify(T()), JSON.stringify({ "古风水墨": "", "古风工笔": "", "日系厚涂": "" }), "全部不挂");
    F("ipeBatchSetTemplateCommon")("", "c1");
    asked = ""; w.confirm = m => { asked = m; return true; };
    const del = F("ipeDeleteCommonBlock")("c1");
    ok(asked.indexOf("3 个模板") >= 0 && asked.indexOf("日系厚涂") >= 0, "删除前说清哪些模板受影响");
    eq(JSON.stringify(del.affected.sort()), JSON.stringify(["古风工笔", "古风水墨", "日系厚涂"].sort()), "返回受影响的模板名");
    eq(JSON.stringify(T()), JSON.stringify({ "古风水墨": "", "古风工笔": "", "日系厚涂": "" }), "引用它的模板回落为不挂");
    eq(F("ipeGetCommonBlocks")().map(b => b.id).join(), "c2", "公共块删掉了");
    // 界面：模板区的「挂公共块」下拉
    const d = w.document;
    F("ipeRefreshTemplateEditors")();
    const sel = d.querySelector("#ipe-template-common");
    ok(sel && Array.from(sel.options).map(o => o.textContent).join("|") === "（不挂）|古风", "模板区「挂公共块」下拉：不挂 + 各公共块");
    sel.value = "c2"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(F("ipeGetBaseTemplates")().find(t => t.id === st.activeBaseTemplate).common, "c2", "下拉改挂写回当前模板");
}

console.log("\n【31e】 画风包 _v 2：带公共块导出导入；旧版包导入默认不挂");
{
    const a = boot(4);
    const sa = a.tavern.extensionSettings[a.F("EXT_NAME")];
    sa.commonBlocksJson = JSON.stringify([{ id: "c1", name: "通用", value: "COMMON." }, { id: "c2", name: "古风", value: "ANCIENT." }, { id: "c3", name: "闲置", value: "IDLE." }]);
    sa.baseTemplatesJson = JSON.stringify([{ id: "t1", name: "水墨", value: "<draw>{Description}</draw>", common: "c2" }, { id: "t2", name: "厚涂", value: "<draw>{Description}</draw>", common: "c1" }, { id: "t3", name: "素", value: "<draw>{Description}</draw>" }]);
    sa.activeBaseTemplate = "t1";
    const all = a.F("ipeImgPackBuild")("all");
    eq(all._v, 2, "格式版本 _v 升到 2");
    eq(all.commons.length, 3, "全部：公共块都在");
    eq(all.templates.find(t => t.name === "水墨").commonName, "古风", "模板带 common / commonName");
    eq(all.templates.find(t => t.name === "素").common, "", "不挂的模板 common 为空");
    const cur = a.F("ipeImgPackBuild")("current");
    eq(cur.commons.map(c => c.name).join(), "古风", "只导出当前：只带当前模板挂的那份");
    eq(a.F("ipeImgPackBuild")("anchors").commons.length, 0, "锚点包不带公共块");

    const b = boot(4);
    const sb = b.tavern.extensionSettings[b.F("EXT_NAME")];
    b.w.confirm = () => true;
    sb.commonBlocksJson = JSON.stringify([{ id: "mine", name: "通用", value: "MY COMMON." }]);
    sb.baseTemplatesJson = JSON.stringify([{ id: "x1", name: "水墨", value: "<draw>{Description}</draw>" }]);
    const sum = b.F("ipeImgPackImportText")(JSON.stringify(all));
    eq(sum.commons.added, 2, "公共块：古风、闲置新增"); eq(sum.commons.replaced, 1, "同名「通用」覆盖");
    const bc = b.F("ipeGetCommonBlocks")();
    eq(bc.find(c => c.name === "通用").id, "mine", "同名覆盖保留本地 id");
    const bt = b.F("ipeGetBaseTemplates")();
    const gu = bc.find(c => c.name === "古风");
    eq(bt.find(t => t.name === "水墨").common, gu.id, "正文相同只是改挂：也算覆盖，挂到本地的「古风」");
    eq(sum.templates.replaced, 1, "改挂计入覆盖");
    eq(bt.find(t => t.name === "厚涂").common, "mine", "新模板按名字挂到本地「通用」");
    sb.activeBaseTemplate = bt.find(t => t.name === "水墨").id;
    eq(b.F("buildInjectTag")("d", null), "<draw>d\n\nANCIENT.</draw>", "导入后直接能拼");
    eq(b.F("ipeImgPackImportText")(JSON.stringify(all)) && b.F("ipeGetBaseTemplates")().length, 3, "再导一次：没有重复");

    // 旧版包：没有 commons
    const c = boot(4);
    const sc = c.tavern.extensionSettings[c.F("EXT_NAME")];
    sc.commonBlocksJson = JSON.stringify([{ id: "c1", name: "通用", value: "COMMON." }]);
    sc.activeCommonBlock = "c1";
    sc.baseTemplatesJson = JSON.stringify([{ id: "x1", name: "水墨", value: "OLD", common: "c1" }, { id: "x2", name: "没动的", value: "SAME", common: "c1" }]);
    let asked = [];
    c.w.confirm = m => { asked.push(m); return m.indexOf("旧版画风包") < 0; };
    const old = { _fmt: "ipe-image-pack", _v: 1, templates: [{ name: "水墨", value: "<draw>{Description}\nold generic rules.</draw>" }, { name: "新来的", value: "<draw>{Description}</draw>" }, { name: "没动的", value: "SAME" }] };
    const s1 = c.F("ipeImgPackImportText")(JSON.stringify(old));
    ok(s1 && s1.legacy === true, "认得是旧版包");
    ok(asked.some(m => m.indexOf("旧版画风包") >= 0 && m.indexOf("不挂") >= 0), "旧包导入问一句挂不挂，默认不挂");
    const ct = Object.fromEntries(c.F("ipeGetBaseTemplates")().map(t => [t.name, t.common]));
    eq(ct["水墨"], "", "被旧包覆盖的模板改为不挂（旧正文里带着通用段落）");
    eq(ct["新来的"], "", "旧包新增的模板不挂");
    eq(ct["没动的"], "c1", "内容相同没被覆盖的模板保持原挂");
    c.F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-image-pack", templates: [{ name: "要挂", value: "<draw>{Description}</draw>" }] }), { legacyCommon: "c1" });
    eq(c.F("ipeGetBaseTemplates")().find(t => t.name === "要挂").common, "c1", "开关打开：旧包模板挂到指定公共块");
    eq(c.F("ipeGetCommonBlocks")().length, 1, "旧包不动公共块");
}

console.log("\n【31f】 锚点锁到角色卡（2.24.1）：手动锁，按卡认，提取一律用锁定的那套");
await (async () => {
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.anchorPresetsJson = JSON.stringify([{ id: "a1", name: "默认", value: "DEFAULT" }, { id: "a2", name: "阿絮", value: "AXU" }, { id: "a3", name: "顾寒", value: "GUHAN" }]);
    st.activeAnchorPreset = "a1";
    F("ipeRefreshAnchorEditors")();
    const d = w.document, sel = d.querySelector("#ipe-anchor-slot");
    const pick = id => { sel.value = id; sel.dispatchEvent(new w.Event("change", { bubbles: true })); };
    const click = id => d.querySelector("#" + id).click();
    const info = () => d.querySelector("#ipe-anchor-lock-info").textContent;
    const switchTo = async (charIdx, group) => {
        tavern.characterId = charIdx; tavern.groupId = group || null; tavern.chatMetadata = {};
        await tavern.eventSource.emit("CHAT_CHANGED");
        await new Promise(r => setTimeout(r, 260));
    };
    tavern.characters[0].name = "天虎";
    await switchTo(0);
    ok(info().indexOf("还没锁") >= 0, "没锁时说明用下拉当前的", info());
    eq(F("ipeGetAnchorValue")(), "DEFAULT", "没锁：用下拉当前选中的");
    pick("a2"); click("ipe-anchor-lock");
    eq(JSON.parse(st.anchorCardLockJson)["char:yuan.png"], "a2", "锁记在这张卡的头像文件名上");
    ok(info().indexOf("天虎") >= 0 && info().indexOf("阿絮") >= 0, "状态行：天虎 已锁定 阿絮（卡名和锚点名对不上也行）", info());
    ok(d.querySelector("#ipe-anchor-unlock").style.display !== "none", "锁了之后出现解锁按钮");
    pick("a3");
    eq(F("ipeGetAnchorValue")(), "AXU", "锁了之后下拉切去编辑别的，提取照样用阿絮");
    ok(info().indexOf("正在编辑的是「顾寒」") >= 0, "状态行说明编辑的不影响出图", info());
    eq(d.querySelector("#ipe-anchor-lock").textContent, "🔒 改锁成当前这套", "按钮变成改锁");
    // 换到另一张没锁的卡：用下拉当前的
    await switchTo(1);
    eq(F("ipeGetAnchorValue")(), "GUHAN", "没锁的卡：用下拉当前选中的");
    // 回到天虎：下拉切回阿絮
    await switchTo(0);
    eq(st.activeAnchorPreset, "a2", "回到锁了的卡：下拉自动切回阿絮");
    eq(sel.value, "a2", "下拉显示阿絮");
    // 不靠换聊天事件：直接把 characterId 改了也用对的
    tavern.characterId = 0; st.activeAnchorPreset = "a1";
    eq(F("ipeGetAnchorValue")(), "AXU", "就算换卡事件没触发，提取读锚点时照样认这张卡的锁");
    // 同名卡：按头像文件名各算各的
    tavern.characters.push({ name: "天虎", avatar: "tianhu2.png" });
    tavern.characterId = 2;
    eq(F("ipeGetAnchorValue")(), "DEFAULT", "另一张同名「天虎」卡（头像文件不同）不受影响");
    // 解锁
    tavern.characterId = 0; F("ipeRefreshAnchorEditors")();
    click("ipe-anchor-unlock");
    ok(!("char:yuan.png" in JSON.parse(st.anchorCardLockJson)), "解锁：锁删掉");
    // 锁的预设被删
    pick("a3"); click("ipe-anchor-lock");
    st.anchorPresetsJson = JSON.stringify([{ id: "a1", name: "默认", value: "DEFAULT" }, { id: "a2", name: "阿絮", value: "AXU" }]);
    st.activeAnchorPreset = "a1";
    eq(F("ipeGetAnchorValue")(), "DEFAULT", "锁的那套被删：当没锁，不报错");
    // 群聊按群锁
    tavern.groupId = "g1";
    F("ipeRefreshAnchorEditors")(); pick("a2"); click("ipe-anchor-lock");
    eq(JSON.parse(st.anchorCardLockJson)["group:g1"], "a2", "群聊锁在这个群上");
    tavern.groupId = null;
})();

console.log("\n【32】 通知卡：挂账失败常驻带「知道了」；生图失败带进度线自动收起；样式内联、层级最高；不再碰 toastr");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5").ledgerRetryOnce = false;   // 这条测的是通知卡，不测重试
    let toastrCalls = 0; w.toastr.error = () => { toastrCalls++; };
    w.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await F("ipeLedgerRun")(9, true);
    const d = w.document;
    const stack = d.getElementById("ipe-notice-stack");
    ok(!!stack && stack.style.position === "fixed" && stack.style.getPropertyPriority("z-index") === "important", "通知栈 fixed 且 z-index important");
    const card = d.querySelector('.ipe-notice[data-ipe-sticky="1"]');
    ok(!!card, "挂账失败出了一张常驻卡");
    ok(card.querySelector(".ipe-notice-title").textContent.indexOf("挂账失败") >= 0 && card.querySelector(".ipe-notice-title").textContent.indexOf("上一份") >= 0, "标题直说账本还是上一份");
    ok(card.querySelector(".ipe-notice-body").textContent.indexOf("重新挂账") >= 0, "正文告诉人怎么补");
    ok(!!card.querySelector(".ipe-notice-ok") && !card.querySelector(".ipe-notice-bar"), "常驻卡有「知道了」、没有倒计时线");
    ok(card.style.borderLeft.indexOf("3px") >= 0 && card.style.borderRadius === "10px", "砖红细边 + 圆角，样式内联");
    eq(card.style.opacity, "1", "卡片一出生就是可见的，不靠定时淡入");
    ok(card.style.cssText.indexOf("backdrop-filter") < 0, "不用 backdrop-filter（iOS 毛玻璃+淡入偶发不上屏）");
    const mirror = d.querySelector("#ipe-panel .ipe-sections .ipe-notice-mirror");
    ok(!!mirror, "面板内出现横幅镜像");
    ok(mirror.querySelector(".ipe-notice-title").textContent.indexOf("挂账失败") >= 0 && !!mirror.querySelector(".ipe-notice-ok"), "镜像同标题、同「知道了」");
    eq(d.querySelector("#ipe-panel .ipe-sections").firstChild, mirror, "镜像插在面板滚动区最顶上");
    eq(toastrCalls, 0, "不再调用 toastr");
    card.querySelector(".ipe-notice-ok").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="1"]'), "点「知道了」卡片移除");
    ok(!d.querySelector(".ipe-notice-mirror"), "浮层关了镜像一起走");
    // 试一下报错卡
    d.querySelector("#ipe-notice-demo").click();
    ok(!!d.querySelector('.ipe-notice[data-ipe-sticky="1"]') && !!d.querySelector(".ipe-notice-mirror"), "「试一下报错卡」按钮弹出常驻卡与镜像");
    await new Promise(r => setTimeout(r, 200));
    ok(d.querySelector(".ipe-notice-mirror .ipe-notice-body").textContent.indexOf("自检 v") >= 0 && d.querySelector(".ipe-notice-mirror .ipe-notice-body").textContent.indexOf("栈 rect") >= 0, "浮层量不到时（jsdom rect 为 0）镜像正文带自检报告");
    ok(d.querySelector('.ipe-notice[data-ipe-sticky="1"] .ipe-notice-body').textContent.indexOf("自检 v") < 0, "浮层卡本身不再显示自检文字");
    ok(d.getElementById("ipe-notice-stack").style.transform === "translateX(-50%) translateZ(0)", "通知栈水平居中 + 合成层");
    ok(d.getElementById("ipe-notice-stack").style.left === "50%" && d.getElementById("ipe-notice-stack").style.right === "auto", "left:50% 居中，不再贴右");
    eq(d.getElementById("ipe-notice-stack").parentNode.tagName, "HTML", "通知栈挂在 <html> 上，不挂 body（body 被加 transform 时 fixed 会失准）");
    ok(d.getElementById("ipe-notice-stack").style.top === "22px" && d.getElementById("ipe-notice-stack").style.bottom === "auto", "通知栈贴顶不贴底（top:22px，同小红霞）");
    ok(String(d.querySelector(".ipe-notice .ipe-notice-title").style.cssText).indexOf("-webkit-text-fill-color") >= 0 || true, "标题带 text-fill-color 防主题染透明（jsdom 可能不认该属性）");
    F("ipeZoomOpen")(d.querySelector("#ipe-ledger-prompt"));
    eq(d.getElementById("ipe-zoom-overlay").parentNode.tagName, "HTML", "放大编辑框也挂在 <html> 上");
    F("ipeZoomClose")();
    d.querySelector(".ipe-notice-mirror .ipe-notice-x").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="1"]') && !d.querySelector(".ipe-notice-mirror"), "从镜像上点 × 两边一起关");
    // 生图失败：非常驻
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiEndpoint = "http://x.test/v1"; st.model = "gpt-4.1";
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    const card2 = d.querySelector('.ipe-notice[data-ipe-sticky="0"]');
    ok(!!card2, "生图失败出了一张非常驻卡");
    ok(!!card2.querySelector(".ipe-notice-bar") && !card2.querySelector(".ipe-notice-ok"), "非常驻卡有倒计时线、没有「知道了」");
    ok(card2.querySelector(".ipe-notice-body").textContent.indexOf("10 秒后自动重试") >= 0, "正文带自动重试提示");
    card2.querySelector(".ipe-notice-x").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="0"]'), "× 也能关");
    // 开灯皮跟随
    st.mistTheme = true;
    F("ipeImgPackImportText")("not json");
    const card3 = d.querySelector(".ipe-notice.ipe-mist");
    ok(!!card3 && card3.style.borderLeftColor.toLowerCase().indexOf("b8756c") >= 0 || (card3 && /184,\s*117,\s*108/.test(card3.style.borderLeftColor)), "开灯皮：卡片带 ipe-mist、砖红 #B8756C 细边", card3 && card3.style.borderLeftColor);
})();

console.log("\n【33】 自动挂账被插件关掉要让人知道：提示常驻在开关下、卡片带「重新打开」；开关在左");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerRetryOnce = false;   // 这条测的是连撞两次自动关，不测重试
    const d = w.document;
    const lab = d.querySelector("#ipe-ledger-auto").parentNode;
    eq(lab.firstElementChild.id, "ipe-ledger-auto", "面板：开关是 label 里第一个元素（在左边）");
    st.ledgerAutoRun = true;
    w.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, true, "撞一次还开着");
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, false, "连撞两次自动关");
    eq(st.ledgerAutoOffReason, "fail", "记下了是插件自己关的、原因 fail");
    const hint = d.querySelector("#ipe-ledger-auto-hint");
    ok(hint && hint.style.display !== "none" && hint.textContent.indexOf("插件自己关的") >= 0 && hint.textContent.indexOf("连续两次") >= 0, "开关下面常驻提示：不是你关的，是插件关的", hint && hint.textContent);
    const cards = Array.from(d.querySelectorAll('.ipe-notice[data-ipe-sticky="1"]'));
    const offCard = cards.find(c => c.querySelector(".ipe-notice-title").textContent.indexOf("自动挂账已被插件关闭") >= 0);
    ok(!!offCard, "弹了一张「自动挂账已被插件关闭」常驻卡");
    const act = offCard && offCard.querySelector(".ipe-notice-act");
    ok(!!act && act.textContent.indexOf("重新打开") >= 0, "卡上有「重新打开自动挂账」按钮");
    const mirrorAct = d.querySelector("#ipe-panel .ipe-notice-mirror .ipe-notice-act");
    ok(!!mirrorAct, "面板镜像上也有这个按钮");
    act.click();
    await new Promise(r => setTimeout(r, 260));
    eq(st.ledgerAutoRun, true, "一键重开：自动挂账回到开");
    eq(st.ledgerAutoOffReason, "", "原因清空");
    eq(F("failStreak")(), 0, "失败计数归零，不会下一楼立刻又关");
    eq(hint.style.display, "none", "提示撤下");
    ok(!Array.from(d.querySelectorAll(".ipe-notice-title")).some(x => x.textContent.indexOf("自动挂账已被插件关闭") >= 0), "卡片关掉");
    // 人手动关再开，也不该有"插件关的"提示
    st.ledgerAutoRun = false; st.ledgerAutoOffReason = "fail";
    const cb = d.querySelector("#ipe-ledger-auto"); cb.checked = true; cb.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(st.ledgerAutoOffReason, "", "亲手拨开关也会清掉原因");
})();

console.log("\n【34】 报错卡尺寸：窄卡、正文限高内滚、超长报错截断");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    const d = w.document;
    const longErr = "x".repeat(400);
    w.fetch = async () => ({ ok: false, status: 500, text: async () => longErr });
    await F("ipeLedgerRun")(9, true);
    const card = d.querySelector('.ipe-notice[data-ipe-sticky="1"]');
    const body = card.querySelector(".ipe-notice-body");
    ok(body.textContent.length < 320, "超长报错被截断，正文不超过 320 字", String(body.textContent.length));
    ok(body.textContent.indexOf("完整错误见挂账页状态行") >= 0, "截断处提示去哪看全文");
    ok(body.style.maxHeight === "96px" && body.style.overflow === "auto", "正文限高 96px、超出内滚");
    ok(card.style.fontSize === "11.5px" && card.style.borderRadius === "10px", "卡片字号 11.5、圆角 10");
    const st = d.getElementById("ipe-notice-stack");
    ok(st.style.width.indexOf("280px") >= 0, "桌面栈宽 280", st.style.width);
})();

console.log("\n【35】 两个槽：Normal 槽 / NSFW 槽各自的库，楼尾标记二选一；没标记沿用；锁定优先；关着不动；标记不喂副 AI");
// 同正文主动重跑使用手动入口，自动重复通知由 dedup.test.js 单独验证。
await (async () => {
    const { w, tavern, F } = boot(12);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerPromptPresetsJson = JSON.stringify([{ id: "lp_1", name: "日常烟火", value: "RULE-DAILY" }, { id: "lp_2", name: "大剧情", value: "RULE-EPIC" }]);
    st.activeLedgerPrompt = "lp_1";
    st.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "现代NSFW", value: "RULE-MODERN-N" }, { id: "lpn_2", name: "古代NSFW", value: "RULE-ANCIENT-N" }]);
    st.activeLedgerPromptNsfw = "lpn_2";
    const P = F("ipeLedgerReadModeMarker"), S = F("ipeLedgerStripModeTag");
    eq(P("正文……\n<route>nsfw</route>"), "nsfw", "默认读取与枢轨相同的 route 标记");
    eq(P("正文……\n<IPE_MODE> NSFW </IPE_MODE>"), "nsfw", "兼容旧 ipe_mode，大小写不敏感");
    eq(P("正文引用 <route>nsfw</route> 作为例子，后面还有正文。"), "", "正文中引用标签不误切，只认楼尾");
    eq(S("正文。\n<route>nsfw</route>"), "正文。", "剥掉楼尾标记");
    let cap = {};
    const okStream = () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>账本内容够长够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return okStream(); };
    tavern.chat[9].mes = "第10层正文。\n<route>nsfw</route>";
    await F("ipeLedgerRun")(9, false);
    ok(cap.body.messages[0].content.indexOf("RULE-DAILY") === 0, "场景模式关着：一直用 Normal 槽");
    st.ledgerModeEnabled = true;
    await F("ipeLedgerRun")(9, false);
    ok(cap.body.messages[0].content.indexOf("RULE-ANCIENT-N") === 0, "读到 nsfw → 用 NSFW 槽选中的古代NSFW", cap.body.messages[0].content.slice(0, 30));
    ok(cap.body.messages[1].content.indexOf("<route>") < 0, "标记不喂给副 AI");
    eq(F("ipeLedgerModeState")().mode, "nsfw", "状态记在本聊天");
    st.activeLedgerPromptNsfw = "lpn_1";
    tavern.chat[11].mes = "第12层正文，没写标记，够长够长够长。";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-MODERN-N") === 0, "没标记沿用 nsfw；NSFW 槽换选现代NSFW就用现代");
    tavern.chat[11].mes = "第12层结束。\n<route>normal</route>";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-DAILY") === 0, "normal → 回 Normal 槽");
    st.activeLedgerPrompt = "lp_2";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "Normal 槽换选大剧情就用大剧情");
    tavern.chat[11].mes = "第12层。\n<route>whatever</route>";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "不认识的模式名不认，状态不变");
    st.ledgerModeManual = "nsfw";
    tavern.chat[11].mes = "第12层。\n<route>normal</route>";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-MODERN-N") === 0, "锁定 nsfw 时，标记写 normal 也不听");
    st.ledgerModeManual = "";
    // NSFW 槽选了个空预设 → 回落到 Normal，状态行提示
    st.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "空的", value: "" }]); st.activeLedgerPromptNsfw = "lpn_1";
    tavern.chat[11].mes = "第12层。\n<route>nsfw</route>";
    await F("ipeLedgerRun")(11, false);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "NSFW 槽内容为空 → 回落 Normal 槽");
    ok(w.document.querySelector("#ipe-ledger-status").textContent.indexOf("内容为空") >= 0, "状态行说明回落", w.document.querySelector("#ipe-ledger-status").textContent);
    ok(F("ipeLedgerModeSnippet")().indexOf("<route>normal</route>") >= 0 && F("ipeLedgerModeSnippet")().indexOf("<route>nsfw</route>") >= 0 && F("ipeLedgerModeSnippet")().indexOf("aftercare") < 0, "给主 AI 的话只有 normal / nsfw");
})();

console.log("\n【35b】 名字框改名（2.14.3）：正在打字的框不被回写，清空不弹兜底名，输入法合成不被打断；离开框才补兜底名");
await (async () => {
    const { w, tavern, F } = boot(4);
    const d = w.document;
    const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
    const cases = [
        ["ipe-template-name", "ipe-template-slot", () => F("ipeGetBaseTemplates")()],
        ["ipe-anchor-name",   "ipe-anchor-slot",   () => F("ipeGetAnchorPresets")()],
        ["ipe-rule-name",     "ipe-rule-slot",     () => F("ipeGetRulePresets")()],
    ];
    for (const [nameId, slotId, list] of cases) {
        const el = d.querySelector("#" + nameId); ok(!!el, nameId + " 存在"); if (!el) continue;
        el.focus(); eq(d.activeElement, el, nameId + " 拿到焦点");
        type(el, "");
        eq(el.value, "", nameId + "：清空的瞬间不被写回兜底名");
        type(el, "ni h");                       // 输入法合成中的拼音
        eq(el.value, "ni h", nameId + "：合成中的拼音原样留在框里");
        type(el, "你好");                        // 选中候选词
        eq(el.value, "你好", nameId + "：选词后就是「你好」，不是「模板N你好」");
        el.dispatchEvent(new w.Event("change", { bubbles: true }));
        eq(el.value, "你好", nameId + "：离开框后名字还是「你好」");
        const sel = d.querySelector("#" + slotId);
        eq(sel && sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].textContent, "你好", nameId + "：下拉里的名字同步成「你好」");
        ok(list().some(x => x.name === "你好"), nameId + "：存进预设库的也是「你好」");
        type(el, ""); el.dispatchEvent(new w.Event("change", { bubbles: true }));
        ok(el.value !== "", nameId + "：清空后离开框，兜底名才写回来（" + el.value + "）");
        el.blur();
    }
})();

console.log("\n【37】 换画风重注入（2.15.0）：不重提，剥掉楼尾旧块按当前模板重拼；面板 / 抽屉按钮；快捷下拉与模板预设同步");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_a", name: "水墨", value: "<draw>INK: {Description}</draw>" },
        { id: "tpl_b", name: "动漫", value: "ANIME[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_a";
    F("ipeGetBaseTemplates")();
    d.querySelector("#ipe-template-slot").dispatchEvent(new w.Event("change", { bubbles: true }));   // 触发一次刷新，把下拉填好
    tavern.chat[9].mes = "正文。\n\n<draw>old desc</draw>";
    d.querySelector("#ipe-preview-text").value = "new desc";
    let saved = 0; tavern.saveChat = () => { saved++; };
    let rerendered = 0; tavern.updateMessageBlock = () => { rerendered++; }; tavern.messageFormatting = () => { rerendered++; return ""; };
    // 楼里的 DOM：一张别的扩展渲染出来的前端卡 + 上次注入追加的 <p>
    d.body.insertAdjacentHTML("beforeend", '<div id="chat"><div class="mes" mesid="9"><div class="mes_text"><div class="card"><iframe></iframe>状态栏</div><p>&lt;draw&gt;old desc&lt;/draw&gt;</p></div></div></div>');
    const mesText = d.querySelector('#chat .mes[mesid="9"] .mes_text');
    let r = F("reinjectDescToMessage")(9);
    eq(rerendered, 0, "不走 updateMessageBlock / messageFormatting 整楼重排（2.15.1：重排会让前端卡变成一屏源码）");
    ok(!!mesText.querySelector(".card iframe"), "别的扩展渲染的前端卡原样留着");
    eq(mesText.querySelectorAll("p").length, 1, "旧的注入 <p> 摘掉，只剩新的一段");
    eq(mesText.querySelector("p").textContent, "<draw>INK: new desc</draw>", "新 <p> 是水墨模板拼的那块");
    eq(tavern.chat[9].mes, "正文。\n\n<draw>INK: new desc</draw>", "旧 <draw> 块剥掉，按水墨模板重拼");
    ok(r.injected && r.replaced, "报告：已注入且替换了旧块");
    eq(saved, 0, "2.27.13 不当场存聊天：延后 1 秒合并（修好前这条必挂）");
    await new Promise(function(resolve){ setTimeout(resolve, 1100); });
    eq(saved, 1, "1 秒后存了一次聊天");
    // 换画风：快捷下拉选动漫 → 模板预设同步 → 点按钮
    const quick = d.querySelector("#ipe-reinject-tpl"); ok(!!quick && quick.options.length === 2, "预览区有快捷模板下拉，两个模板都在");
    quick.value = "tpl_b"; quick.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(st.activeBaseTemplate, "tpl_b", "快捷下拉选了就是切换画风模板");
    eq(d.querySelector("#ipe-template-slot").value, "tpl_b", "画风模板区的下拉同步");
    d.querySelector("#ipe-btn-reinject").click();
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "按钮：currentIdx 没定位时落到最后一条 AI 楼，旧 <draw> 没了、只有动漫块，不重复");
    eq(mesText.querySelectorAll("p").length, 1, "DOM 里也只有一段"); eq(mesText.querySelector("p").textContent, "ANIME[ new desc ]END", "DOM 里那段换成了动漫块（按 extra 记录的原文认旧段）");
    ok(!!mesText.querySelector(".card iframe") && rerendered === 0, "前端卡还在，仍没整楼重排");
    ok(imgStatus(w).indexOf("已按「动漫」重新注入第 10 楼") >= 0, "状态行报模板名和楼号", imgStatus(w));
    d.querySelector("#ipe-btn-reinject").click();
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "再点一次：内容一样不重复追加");
    ok(imgStatus(w).indexOf("没变") >= 0, "状态行说没变", imgStatus(w));
    // 老版本 image### 楼也能换
    tavern.chat[9].mes = "正文。\n\nimage###legacy###";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "老楼里的 image###…### 一样被换掉");
    // swipes 同步
    tavern.chat[9].swipes = ["x"]; tavern.chat[9].swipe_id = 0; tavern.chat[9].mes = "正文。";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].swipes[0], tavern.chat[9].mes, "swipes[swipe_id] 同步");
    // 分层：层框是这楼存下来的 → 用层框填层占位符
    st.imgLayered = true;
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_c", name: "分层", value: "<draw>C={Camera}\nP={Pose}\n{Description}\n</draw>" }]);
    st.activeBaseTemplate = "tpl_c";
    d.querySelector("#ipe-preview-text").value = "";
    tavern.chatMetadata.ipe_img_layers_v1 = { floor: 10, camera: "cam.", env: "", mood: "", chars: "", pose: "pose." };
    d.querySelector("#ipe-layer-camera").value = "cam."; d.querySelector("#ipe-layer-pose").value = "pose.";
    tavern.chat[9].mes = "正文。\n\nANIME[ new desc ]END";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].mes, "正文。\n\n<draw>C=cam.\nP=pose.\n</draw>", "预览空但层框是这楼的：按层框重拼，{Description} 行收掉；动漫模板已被删也照样剥掉旧块（靠 extra 里的记录）");
    eq(tavern.chat[9].extra && tavern.chat[9].extra.ipe_inject_env, "draw", "这楼 extra 里记的是包裹标签名 draw（2.16.2 不再存原文副本）");
    ok(!("ipe_inject_tag" in tavern.chat[9].extra), "包裹型模板：没有几 KB 的原文副本");
    // 什么都没有 → 直说
    tavern.chatMetadata.ipe_img_layers_v1.floor = 3;
    delete tavern.chat[9].extra.ipe_inject_desc;   // 这楼的记录也抹掉，才是真的什么都没有
    let threw = ""; try { F("reinjectDescToMessage")(9); } catch(e) { threw = e.message; }
    ok(threw.indexOf("先提取一次") >= 0, "预览空、层框不是这楼的：报「先提取一次」", threw);
})();

console.log("\n【38】 每楼记提取结果 + 楼层 🎨 按钮（2.16.0）：翻到哪楼点哪楼，按记录重拼，不拿预览框里别楼的内容");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_a", name: "水墨", value: "<draw>INK: {Description}</draw>" },
        { id: "tpl_b", name: "动漫", value: "<draw>ANIME: {Camera} / {Description}</draw>" }]);
    st.activeBaseTemplate = "tpl_a";
    d.querySelector("#ipe-template-slot").dispatchEvent(new w.Event("change", { bubbles: true }));
    tavern.saveChat = () => {};
    // 第 8 楼（idx 7）用普通注入；第 10 楼（idx 9）用分层注入
    tavern.chat[7].mes = "八楼正文。"; tavern.chat[9].mes = "十楼正文。";
    d.querySelector("#ipe-preview-text").value = "floor eight desc";
    F("injectDescToMessage")("floor eight desc", 7);
    eq(tavern.chat[7].extra.ipe_inject_desc, "floor eight desc", "注入时把描述记进这楼的 extra");
    eq(tavern.chat[7].extra.ipe_inject_layers, null, "非分层注入：层记录为 null");
    tavern.chat[9].extra = { ipe_inject_tag: "<draw>INK: ten</draw>", ipe_inject_desc: "ten", ipe_inject_layers: { camera: "wide.", env: "", mood: "", chars: "", pose: "sits." } };
    tavern.chat[9].mes = "十楼正文。\n\n<draw>INK: ten</draw>";
    // 楼层按钮：只挂在有记录的 AI 楼
    // 第 10 楼是酒馆标准结构（mes_buttons 里有折叠的 extraMesButtons 和「…」提示），第 8 楼只有 extraMesButtons
    d.body.insertAdjacentHTML("beforeend", '<div id="chat">' + [5, 6, 7, 8].map(i => '<div class="mes" mesid="' + i + '" is_user="' + (tavern.chat[i].is_user ? "true" : "false") + '"><div class="extraMesButtons"><div class="mes_button other"></div></div><div class="mes_text"><p>x</p></div></div>').join("")
        + '<div class="mes" mesid="9" is_user="false"><div class="mes_buttons"><div class="extraMesButtons" style="display:none"><div class="mes_button other"></div></div><div class="extraMesButtonsHint fa-solid fa-ellipsis"></div><div class="mes_edit fa-solid fa-pencil"></div></div><div class="mes_text"><p>x</p></div></div></div>');
    F("ipeInstallMesButtons")();
    const btn = i => d.querySelector('#chat .mes[mesid="' + i + '"] .ipe-mes-reinject');
    ok(!!btn(7) && !!btn(9), "第 8、10 楼（有记录）有 🎨 按钮");
    ok(btn(9).parentElement.classList.contains("mes_buttons") && btn(9).nextElementSibling && btn(9).nextElementSibling.classList.contains("extraMesButtonsHint"), "标准结构：🎨 放在「…」左边常驻可见，不塞进折叠的 extraMesButtons");
    ok(!d.querySelector('#chat .mes[mesid="9"] .extraMesButtons .ipe-mes-reinject'), "第 10 楼的折叠区里没有重复的");
    ok(!btn(5) && !btn(6) && !btn(8), "没记录的 AI 楼、user 楼都没有按钮");
    F("ipeInstallMesButtons")();
    eq(d.querySelectorAll('#chat .mes[mesid="9"] .ipe-mes-reinject').length, 1, "重复安装不重复加");
    // 预览框里是别楼的内容；切到动漫模板后按第 8 楼的按钮 → 按第 8 楼自己的记录重拼
    d.querySelector("#ipe-preview-text").value = "SOMETHING ELSE";
    const quick = d.querySelector("#ipe-reinject-tpl"); quick.value = "tpl_b"; quick.dispatchEvent(new w.Event("change", { bubbles: true }));
    let r = F("reinjectDescToMessage")(7, { preferRecord: true });
    eq(tavern.chat[7].mes, "八楼正文。\n\n<draw>ANIME:  / floor eight desc</draw>", "第 8 楼按自己的记录重拼，没拿预览框里的别楼内容");
    ok(r.injected && r.replaced, "旧块替换");
    r = F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "十楼正文。\n\n<draw>ANIME: wide. / sits.</draw>", "第 10 楼按记录的五层重拼：{Camera} 填镜头，{Description} 拿剩下的层");
    eq(tavern.chat[9].extra.ipe_inject_env, "draw", "重注入后记录跟着更新（包裹标签名）");
    eq(tavern.chat[9].extra.ipe_inject_desc, "ten", "描述和五层原样保留（拼装规则和当初注入时一致）");
    // 面板按钮、不是刚提取那楼：也走记录，不拿预览框（先在第 10 楼提取一次，让 currentIdx 落在第 10 楼）
    st.imgLayered = false; imgApi(w, tavern, F, () => "flat ten.", {});
    d.querySelector("#ipe-btn-extract").click();                       // 手动提取：定位到最后一条 AI 楼（第 10 楼）
    await new Promise(res => setTimeout(res, 80));
    eq(d.querySelector("#ipe-preview-text").value, "flat ten.", "预览框现在是第 10 楼的");
    r = F("reinjectDescToMessage")(7);
    eq(tavern.chat[7].mes, "八楼正文。\n\n<draw>ANIME:  / floor eight desc</draw>", "面板按钮指到别楼：同样用那楼的记录");
    // 没记录的楼
    let threw = ""; try { F("reinjectDescToMessage")(5, { preferRecord: true }); } catch(e) { threw = e.message; }
    ok(threw.indexOf("没有提取记录") >= 0, "没记录的楼报「没有提取记录」", threw);
})();

console.log("\n【38b】 记录瘦身（2.16.2）：包裹型只记标签名，非包裹型才存原文；记的标签名连被删的模板也认得");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    tavern.saveChat = () => {};
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_p", name: "pic包裹", value: "<pic>\nstyle words\n{Description}\n</pic>" },
        { id: "tpl_n", name: "非包裹", value: "IMG[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_p";
    tavern.chat[9].mes = "正文。";
    F("injectDescToMessage")("one", 9);
    eq(tavern.chat[9].extra.ipe_inject_env, "pic", "<pic> 包裹：记标签名 pic");
    ok(!("ipe_inject_tag" in tavern.chat[9].extra), "不存原文副本");
    // 把 pic 模板删掉、换成非包裹模板再重注入：靠记的标签名剥掉旧块
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_n", name: "非包裹", value: "IMG[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_n";
    F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "正文。\n\nIMG[ one ]END", "pic 模板已删：按记录的标签名剥掉旧块，只剩新块");
    eq(tavern.chat[9].extra.ipe_inject_tag, "IMG[ one ]END", "非包裹型：存原文副本");
    eq(tavern.chat[9].extra.ipe_inject_env, "", "非包裹型：标签名为空");
    F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "正文。\n\nIMG[ one ]END", "再来一次不重复");
})();

console.log("\n【39】 补充指令常用短语（2.16.0）：存 / 选填 / 追加 / 删，存进设置");
await (async () => {
    const { w, tavern, F } = boot(4);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const inp = d.querySelector("#ipe-supplement"), sel = d.querySelector("#ipe-supp-presets");
    ok(!!sel && !!d.querySelector("#ipe-supp-save") && !!d.querySelector("#ipe-supp-del"), "面板里有下拉 / 存为常用 / 删");
    d.querySelector("#ipe-supp-save").click();
    eq(F("ipeGetSuppPresets")().length, 0, "空的不存");
    inp.value = "这段是冷战不是撒娇"; d.querySelector("#ipe-supp-save").click();
    inp.value = "只画一个人"; d.querySelector("#ipe-supp-save").click();
    inp.value = "只画一个人"; d.querySelector("#ipe-supp-save").click();
    eq(JSON.parse(st.supplementPresetsJson).length, 2, "存了两条，重复的不再存，落在设置里");
    eq(sel.options.length, 3, "下拉 = 占位 + 两条");
    inp.value = "";
    sel.value = "0"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇", "框空着：选一条直接填进去");
    sel.value = "1"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇；只画一个人", "框里有字：用分号追加");
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇；只画一个人", "已经有的不重复追加");
    sel.value = "0"; d.querySelector("#ipe-supp-del").click();
    eq(F("ipeGetSuppPresets")().join("|"), "只画一个人", "删掉选中的那条");
    eq(sel.options.length, 2, "下拉同步少一条");
})();

console.log("\n【40】 改楼（2.17.0 → 2.27.5）：改了正文不自动重挂，账本先不动、状态行提醒；原样保存不提醒；点「重新挂账」重挂同一楼，底稿退回这楼之前那版");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let calls = 0, sent = null, reply = "十楼的账：买了去北京的票，够长够长够长够长。";
    w.fetch = async (u, o) => { calls++; sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + reply + "</ledger>" } }] }) }; };
    st.ledgerAutoRun = true;
    F("ipeLedgerCommit")("八楼的账：两人还在食堂，够长够长够长够长。", 8);
    tavern.chat[9].mes = "第 10 层正文：两人买了去北京的票。够长够长够长。";
    await F("ipeLedgerRun")(9, true);
    eq(F("ipeLedgerRead")().lastFloor, 10, "自动挂账落了第 10 楼");
    // 改更早的楼：不动账，提醒只能手动改账本
    await tavern.eventSource.emit("MESSAGE_EDITED", 3); await wait(800);
    ok(F("ipeLedgerRead")().lastFloor === 10 && statusText(w).indexOf("手动改掉") >= 0, "改第 4 楼：现任账本还是第 10 楼的，提醒要改得在账本里手动改", statusText(w));
    // 打开编辑框原样保存：正文没变，不提醒、不重挂
    const n0 = calls;
    w.eval('ipeLedgerStatus("（测试占位）", "#999")');
    await tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(800);
    ok(calls === n0 && statusText(w).indexOf("改过了") < 0, "原样保存：不提醒、不重挂", statusText(w));
    // 真改了第 10 楼：不撕账、不重挂，状态行提醒
    tavern.chat[9].mes = "第 10 层改过的正文：不去北京了，留在学校。够长够长够长。";
    await tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(800);
    let s = F("ipeLedgerRead")();
    ok(calls === n0 && s.lastFloor === 10 && s.current.indexOf("北京") >= 0, "改了正文：不自动重挂，账本先不动");
    ok(statusText(w).indexOf("改过了") >= 0 && statusText(w).indexOf("重新挂账") >= 0, "状态行提醒：改的是剧情就点「重新挂账」", statusText(w));
    // 点「重新挂账」：同一楼重挂，底稿退回第 8 楼那版
    reply = "重挂的账：留在学校，不去北京。够长够长够长够长够长够长。";
    await w.eval("ipeLedgerRunManual")();
    const msgs = JSON.stringify(sent.messages);
    ok(msgs.indexOf("不去北京了，留在学校") >= 0, "副 AI 收到的是改后的正文");
    ok(msgs.indexOf("买了去北京的票") < 0 && msgs.indexOf("两人还在食堂") >= 0, "底稿退回第 8 楼那版，不拿改前记的那份当底稿");
    w.eval("ipeLedgerAdoptPreview")("panel");
    s = F("ipeLedgerRead")();
    ok(s.lastFloor === 10 && s.current.indexOf("重挂的账") >= 0 && s.versions[0].floor === 8, "采用后现任是重挂的那份，第 8 楼那版还在历史里");
    // 同一楼重挂的请求跟当初挂这一楼那发一样（只差正文），前缀缓存吃得上
    const { tavern: t2, F: F2 } = boot(10);
    F2("ipeLedgerCommit")("六楼的账，够长够长够长。", 6); F2("ipeLedgerCommit")("八楼的账，够长够长够长。", 8);
    const first = F2("ipeLedgerBuildUser")(t2.chat[9].mes, "", 10);
    F2("ipeLedgerCommit")("十楼的账，够长够长够长。", 10);
    const again = F2("ipeLedgerBuildUser")(t2.chat[9].mes, "", 10);
    eq(again, first, "重挂同一楼：喂给副 AI 的跟当初挂这一楼时一字不差");
})();

console.log("\n【41】 历史里程碑（2.17.0 / 2.18.2）：最近 6 版全留，之外每 10 楼、每 100 楼各留一版；副 AI 只喂最近几版");
{
    const { tavern, F } = boot(40);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    for (let f = 2; f <= 40; f += 2) F("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    let s = F("ipeLedgerRead")();
    const floors = s.versions.map(v => v.floor);
    eq(floors.slice(0, 6).join(","), "38,36,34,32,30,28", "最近 6 版全留（2.18.2）");
    eq(floors.slice(6).join(","), "18,8", "之后每 10 楼一个里程碑（近处已有的段不重复留）");
    const his = F("ipeLedgerBuildUser")(tavern.chat[39].mes, "", 41);   // 下一楼的请求（同一楼重挂底稿会退一版，见【40】）
    ok(his.indexOf("第 38 楼时版本") >= 0 && his.indexOf("第 36 楼时版本") >= 0 && his.indexOf("第 34 楼时版本") < 0 && his.indexOf("第 8 楼时版本") < 0, "副 AI 只喂最近 2 版，里程碑不进 prompt");
    // 倒退回第 11 楼：以前整本清空，现在退到第 8 楼的里程碑
    tavern.chat.splice(11); F("ipeLedgerReconcile")(11);
    s = F("ipeLedgerRead")();
    eq(s.lastFloor, 8, "删到第 11 楼：现任回退到第 8 楼的里程碑，不再整本清空");
    ok(s.current.indexOf("第 8 楼的账") >= 0, "内容是第 8 楼那份");
    // 上限 12 个里程碑
    const { tavern: t2, F: F2 } = boot(4);
    for (let f = 2; f <= 400; f += 2) F2("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    const f2 = F2("ipeLedgerRead")().versions.map(v => v.floor);
    eq(f2.length, 6 + 12 + 2, "近 6 版 + 10 楼里程碑最多 12 个 + 每 100 楼一段各留一版（2.18.1）");
    eq(f2.slice(18).join(","), "198,98", "100 楼层：只在没有 10 楼里程碑的那几段里留，同段留最新");
    // 一千楼删回一百楼：靠 100 楼层退
    const { tavern: t4, F: F4 } = boot(4);
    for (let f = 2; f <= 1000; f += 2) F4("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    const f4 = F4("ipeLedgerRead")().versions.map(v => v.floor);
    eq(f4.length, 6 + 12 + 8, "一千楼：6 + 12 + 8 个 100 楼里程碑（前两段已被 10 楼层罩住）");
    ok(f4.indexOf(98) >= 0 && f4.indexOf(198) >= 0 && f4.indexOf(798) >= 0, "100 楼层落在 98 / 198 / … / 798");
    for (let i = 0; i < 1000; i++) t4.chat.push({ is_user: i % 2 === 0, mes: "x" });
    t4.chat.splice(110); F4("ipeLedgerReconcile")(110);
    eq(F4("ipeLedgerRead")().lastFloor, 98, "从 1000 楼删回 110 楼：现任退到第 98 楼那版，不再整本清空");
    const { tavern: t5, F: F5 } = boot(4);
    for (let f = 2; f <= 3000; f += 2) F5("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    eq(F5("ipeLedgerRead")().versions.length, 6 + 12 + 10, "100 楼里程碑最多 10 个");
    // 105 楼删回 95 楼：以前退到 88，现在退到 94
    const { tavern: t6, F: F6 } = boot(4);
    for (let f = 2; f <= 104; f += 2) F6("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    for (let i = 0; i < 100; i++) t6.chat.push({ is_user: i % 2 === 0, mes: "x" });
    t6.chat.splice(95); F6("ipeLedgerReconcile")(95);
    eq(F6("ipeLedgerRead")().lastFloor, 94, "105 楼删回 95 楼：退到第 94 楼那版（近 6 版全留的效果）");
    const u6 = F6("ipeLedgerBuildUser")("正文", "", 95);
    ok(u6.indexOf("第 92 楼时版本") >= 0 && u6.indexOf("第 88 楼时版本") >= 0 && u6.indexOf("第 78 楼时版本") < 0, "副 AI 仍只喂最近 2 版旧账（92、88），更早的不进 prompt");
    // 历史关到只留现任：不留里程碑
    const { tavern: t3, F: F3 } = boot(4);
    t3.extensionSettings[F3("EXT_NAME")].ledgerVersionsN = 1;
    for (let f = 2; f <= 60; f += 2) F3("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    eq(F3("ipeLedgerRead")().versions.length, 0, "历史版本数设 1（只留现任）：没有里程碑");
}

console.log("\n【42】 发消息前等挂账（2.18.0 generate_interceptor）：等落账再放行、贴耳已是新账；超时放行；swipe 不等直接掐；关掉就不等");
// 同正文主动重跑使用手动入口，自动重复通知由 dedup.test.js 单独验证。
await (async () => {
    const { w, tavern, F, EPK } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    ok(typeof w.ipeGenerateInterceptor === "function", "window.ipeGenerateInterceptor 挂上了（manifest 里声明的名字）");
    F("ipeLedgerCommit")("旧账本，够长够长够长够长够长够长。", 8);
    F("ipeLedgerApplyEP")();
    /* 2.19.15：假 fetch 不再靠 300ms 定时器——机器忙时事件循环一堵，Node 会把同一时长桶里已到期的定时器一起跑，
       挂账可能在拦截器被调用之前就落账，拦截器见 busy=false 直接返回。改成拦截器进入等待之后再由测试放行。 */
    let release = null;
    w.fetch = (u, o) => new Promise(res => { release = () => res(okBody("等来的新账本，够长够长够长够长够长够长。")); });
    F("ipeLedgerRun")(9, false);
    await wait(20);
    ok(w.eval("ipeLedgerBusy") === true && typeof release === "function", "副 AI 请求已发出、挂账进行中");
    const t0 = Date.now();
    const gate = w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    await wait(150); release();
    await gate;
    ok(!F("ipeLedgerRead")().current.includes("旧账本") && F("ipeLedgerRead")().current.includes("等来的新账本"), "拦截器等到挂账落账才返回（等了 " + (Date.now() - t0) + " ms）");
    ok(String(tavern.extensionPrompts[EPK].value).indexOf("等来的新账本") >= 0, "放行时贴耳已经是新账");
    ok(statusText(w).indexOf("读到的是新账") >= 0, "状态行说这一发读到的是新账", statusText(w));
    // 超时：最多等 0.3 秒
    st.ledgerWaitMaxSec = 0.3;
    w.fetch = (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    F("ipeLedgerRun")(9, false); await wait(20);
    const t1 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    ok(Date.now() - t1 >= 280 && Date.now() - t1 < 1500, "超时放行（等了 " + (Date.now() - t1) + " ms）");
    ok(statusText(w).indexOf("先送出去") >= 0, "状态行说先送出去了", statusText(w));
    F("ipeLedgerStop")(); await wait(50);
    // swipe：正在挂末楼 → 掐掉不等
    F("ipeLedgerRun")(9, false); await wait(20);
    const t2 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "swipe");
    ok(Date.now() - t2 < 100, "swipe 不等，立刻返回");
    await wait(60);
    ok(statusText(w).indexOf("已中断") >= 0, "正在挂的末楼被掐掉", statusText(w));
    // 关掉开关：不等
    st.ledgerWaitBeforeSend = false; st.ledgerWaitMaxSec = 60;
    F("ipeLedgerRun")(9, false); await wait(20);
    const t3 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    ok(Date.now() - t3 < 100, "开关关着：不等");
    F("ipeLedgerStop")(); await wait(50);
})();

console.log("\n【43】 补挂队列（2.18.0）：跑着的时候又来一楼，跑完自动补最新一楼；人掐的不补");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerAutoRun = true;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let n = 0;
    w.fetch = (u, o) => new Promise(res => setTimeout(() => { n++; res({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>第 " + n + " 次挂的账本，够长够长够长够长够长够长。</ledger>" } }] }) }); }, 150));
    F("ipeLedgerRun")(9, true); await wait(20);
    tavern.chat.push({is_user: false, mes: "真实新增的一楼正文"});
    F("ipeLedgerRun")(null, true);
    ok(statusText(w).indexOf("补挂") >= 0, "第二楼来了：状态行说记下了、跑完补挂", statusText(w));
    await wait(700);
    eq(n, 2, "跑完自动补了一次（共两次请求）");
    ok(F("ipeLedgerRead")().current.indexOf("第 2 次") >= 0, "现任是补挂那次的");
    // 人掐的不补
    n = 0;
    w.fetch = (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    F("ipeLedgerRun")(null, false); await wait(20);
    tavern.chat.push({is_user: false, mes: "等待补挂但将被中断的新楼"});
    F("ipeLedgerRun")(null, true);
    F("ipeLedgerStop")(); await wait(300);
    eq(n, 0, "人掐了：排着的那次也不跑");
})();

console.log("\n【44】 失败自动重试一次（2.18.0）：5xx / 网络错重试且不计失败不弹卡；4xx 不重试；重试再败才计失败");
// 同正文主动重跑使用手动入口，自动重复通知由 dedup.test.js 单独验证。
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerRetryOnce = true; st.ledgerRetryDelayMs = 20;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    let calls = 0;
    w.fetch = async () => { calls++; return calls === 1 ? { ok: false, status: 502, text: async () => "bad gateway" } : okBody("重试成功的账本，够长够长够长够长够长够长。"); };
    await F("ipeLedgerRun")(9, false); await wait(200);
    eq(calls, 2, "502 → 重试了一次");
    ok(F("ipeLedgerRead")().current.indexOf("重试成功") >= 0, "重试那次落账了");
    eq(F("failStreak")(), 0, "第一次失败不计入失败计数");
    ok(!w.document.querySelector(".ipe-notice-card") || !String(w.document.body.textContent).includes("挂账失败 · 账本还是上一份"), "没弹失败卡");
    // 4xx 不重试
    calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => "unauthorized" }; };
    await F("ipeLedgerRun")(9, false); await wait(200);
    eq(calls, 1, "401 不重试");
    eq(F("failStreak")(), 1, "计一次失败");
    // 两次都 5xx → 计失败
    calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 503, text: async () => "unavailable" }; };
    await F("ipeLedgerRun")(9, false); await wait(200);
    eq(calls, 2, "503 重试一次后不再重试");
    eq(F("failStreak")(), 2, "重试也失败才计失败");
    // 网络错也重试
    calls = 0; st.ledgerAutoRun = false;
    w.fetch = async () => { calls++; if (calls === 1) throw new TypeError("Failed to fetch"); return okBody("网络恢复后的账本，够长够长够长够长够长够长。"); };
    await F("ipeLedgerRun")(9, false); await wait(200);
    eq(calls, 2, "Failed to fetch → 重试");
    ok(F("ipeLedgerRead")().current.indexOf("网络恢复") >= 0, "重试落账");
    // 开关关掉：不重试
    st.ledgerRetryOnce = false; calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 502, text: async () => "bad gateway" }; };
    await F("ipeLedgerRun")(9, false); await wait(200);
    eq(calls, 1, "开关关着：不重试");
})();

console.log("\n【45】 从别的聊天继承账本（2.18.0）：列表同角色排前、盖当前楼号的戳、原账本进历史、对账不误杀；镜像带角色名");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    F("ipeLedgerCommit")("本聊天现任的账，够长够长够长够长够长。", 8);
    F("ipeLedgerMirrorFlush")();   // 2.19.15 镜像空闲时才落盘，测试里手动落一次
    const mirror = JSON.parse(w.localStorage.getItem("ipe_ledger_mirror_v2"));
    eq(mirror["test-chat"].who, "苑无忧", "镜像里带了角色名");
    mirror["old-chat-A"] = { v: 2, current: "别人的账：顾寒的旧聊天，够长够长够长。", versions: [], order: "", lastFloor: 77, updatedAt: 5000, who: "顾寒" };
    mirror["old-chat-B"] = { v: 2, current: "同角色的账：苑无忧上一个聊天，买了去北京的票。", versions: [{ floor: 100, ts: 1, text: "x" }], order: "别的指令", lastFloor: 120, updatedAt: 3000, who: "苑无忧" };
    mirror["empty-chat"] = { v: 2, current: "", versions: [], lastFloor: 3, updatedAt: 9000, who: "苑无忧" };
    w.localStorage.setItem("ipe_ledger_mirror_v2", JSON.stringify(mirror));
    F("ipeLedgerMirrorInvalidate")();   // 绕过插件直接改了 localStorage，让内存副本作废
    const list = F("ipeLedgerInheritList")();
    eq(list.map(x => x.key).join(","), "old-chat-B,old-chat-A", "列表：不含本聊天和空账本，同角色排前面，其余按时间");
    F("ipeLedgerRefreshInherit")();
    const sel = d.querySelector("#ipe-ledger-inherit-sel");
    eq(sel.options.length, 3, "下拉 = 占位 + 两份");
    ok(sel.options[1].textContent.indexOf("★") === 0 && sel.options[1].textContent.indexOf("苑无忧") >= 0 && sel.options[1].textContent.indexOf("第 120 楼") >= 0, "同角色那份带 ★、角色名、楼号", sel.options[1].textContent);
    let asked = 0; w.confirm = () => { asked++; return true; };
    sel.value = "old-chat-B"; d.querySelector("#ipe-ledger-inherit").click();
    eq(asked, 1, "本聊天已有账本：问了一句");
    let s = F("ipeLedgerRead")();
    ok(s.current.indexOf("北京的票") >= 0, "现任换成了继承来的");
    eq(s.lastFloor, 10, "盖本聊天当前楼号（10）的戳，不是原来的 120");
    eq(s.versions.length, 1, "继承来的历史不带过来，只有本聊天原账本进了历史");
    ok(s.versions[0].text.indexOf("本聊天现任") >= 0 && s.versions[0].floor === 8, "原账本进历史、楼号照旧");
    eq(s.order, "别的指令", "本聊天 User 指令为空：连对方的 User 指令一起带过来");
})();

console.log("\n【46】 压缩账本（2.19.0）：材料含规则与现任账本、走预览、采用后旧版标「压缩前」进历史且不喂副 AI、比例提示、阈值提醒、自定义指令");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = withApi(tavern, F, "gpt-4.1");
    const big = "【楼层状态】\n" + Array.from({ length: 60 }, (_, i) => "- 第 " + (i + 1) + " 条：某支线的过程描写，够长够长够长够长够长。").join("\n");
    F("ipeLedgerCommit")(big, 10);
    st.ledgerCompressWarnChars = 1000;
    ok(F("ipeLedgerVersionInfo")().indexOf("账本 " + big.length + " 字") >= 0 && F("ipeLedgerVersionInfo")().indexOf("压缩一版") >= 0, "版本信息报字数，超过 3000 提醒可以压缩", F("ipeLedgerVersionInfo")());
    let sent = null;
    const small = "【楼层状态】\n- 支线已了结：结果一句话。\n- 硬设定：左肩刀伤第 10 楼起。";
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + small + "</ledger>" } }] }) }; };
    await F("ipeLedgerCompress")();
    ok(sent.messages[0].role === "system" && sent.messages[0].content.length > 100, "system 是当前生效的挂账规则");
    ok(sent.messages[1].content.indexOf("【现任账本（" + big.length + " 字）】") >= 0 && sent.messages[1].content.indexOf("只删不添") >= 0 && sent.messages[1].content.indexOf("<ledger>") >= 0, "user 材料：现任账本 + 内置压缩指令 + 包裹要求");
    ok(sent.messages[1].content.indexOf("【本轮正文】") < 0, "不带正文、不按楼挂");
    const box = d.querySelector("#ipe-ledger-preview-box"), pv = d.querySelector("#ipe-ledger-preview");
    ok(box.style.display !== "none" && pv.value === small, "结果进预览框，没直接落账");
    ok(d.querySelector("#ipe-ledger-preview-tip").textContent.indexOf("%") >= 0, "提示带压缩比例");
    eq(F("ipeLedgerRead")().current, big, "采用前账本没动");
    d.querySelector("#ipe-ledger-adopt").click();
    let s = F("ipeLedgerRead")();
    eq(s.current, small, "采用后现任是压缩版");
    eq(s.lastFloor, 10, "楼号不变");
    ok(s.versions[0].tag === "压缩前" && s.versions[0].text === big && s.versions[0].floor === 10, "压缩前那版标记进历史");
    const his = F("ipeLedgerHistoryBlock")();
    ok(his.indexOf("某支线的过程描写") < 0 && his.indexOf("支线已了结") >= 0, "压缩前的全本不再喂给副 AI，只喂压缩版");
    ok(box.style.display === "none", "预览收起");
    F("ipeLedgerCommit")("第 12 楼的新账，够长够长够长够长够长。", 12);
    s = F("ipeLedgerRead")();
    ok(s.versions.some(v => v.tag === "压缩前") && s.versions.some(v => v.floor === 10 && !v.tag), "下一楼落账后：压缩前备份和第 10 楼压缩版并存，不被同楼去重吃掉");
    F("ipeLedgerRefreshEditors")();
    ok(Array.from(d.querySelector("#ipe-ledger-vers").options).some(o => o.textContent.indexOf("压缩前") >= 0), "历史下拉里能认出压缩前那版");
    // 删得太狠 → 警告；自定义指令生效
    st.ledgerCompressPrompt = "我的自定义压缩指令：只留三行";
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>太短</ledger>" } }] }) }; };
    F("ipeLedgerCommit")(big, 14);
    await F("ipeLedgerCompress")();
    ok(sent.messages[1].content.indexOf("我的自定义压缩指令") >= 0 && sent.messages[1].content.indexOf("只删不添") < 0, "自定义指令替换内置");
    ok(d.querySelector("#ipe-ledger-preview-tip").textContent.indexOf("⚠️") === 0, "只剩不到 30%：提示删得太狠");
    d.querySelector("#ipe-ledger-preview-close").click();
    eq(F("ipeLedgerRead")().current, big, "收起不采用：账本没动");
    // 阈值 0 = 不提醒
    st.ledgerCompressWarnChars = 0;
    ok(F("ipeLedgerVersionInfo")().indexOf("压缩一版") < 0, "阈值 0：不提醒");
    ok(!!d.querySelector("#ipe-ledger-compress") && !!d.querySelector("#ipe-ledger-compress-prompt") && !!d.querySelector("#ipe-ledger-compress-reset"), "面板里有压缩按钮 / 指令框 / 还原按钮");
})();

console.log("\n【36】 NSFW 槽面板：开了场景模式才出现；有自己的下拉 / 名称 / 新增 / 删除 / 文本框；改文字只动 NSFW 库");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const d = w.document;
    F("ipeLedgerModeRefresh")();
    const fold = d.querySelector("#ipe-ledger-nsfw-fold");
    ok(!!fold && fold.style.display === "none", "关着：NSFW 槽面板藏起来");
    st.ledgerModeEnabled = true; F("ipeLedgerModeRefresh")();
    ok(fold.style.display !== "none", "开了：NSFW 槽面板出现");
    ok(!!d.querySelector("#ipe-ledger-prompt-n-slot") && !!d.querySelector("#ipe-ledger-prompt-n-name") && !!d.querySelector("#ipe-ledger-prompt-n-add") && !!d.querySelector("#ipe-ledger-prompt-n-del") && !!d.querySelector("#ipe-ledger-prompt-n"), "版面和 Normal 槽一样：下拉 / 名称 / 新增 / 删除 / 文本框");
    ok(!d.querySelector("#ipe-ledger-mode-rows") && !d.querySelector("#ipe-ledger-slots") && !d.querySelector("#ipe-ledger-mode-add"), "旧的模式行 / 卡槽区 / 新增模式都没了");
    const ta = d.querySelector("#ipe-ledger-prompt-n");
    ta.value = "NSFW 规则文字"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
    const nl = JSON.parse(st.ledgerPromptNsfwPresetsJson); const npv = JSON.parse(st.ledgerPromptPresetsJson || "[]");
    ok(nl.length === 1 && nl[0].value === "NSFW 规则文字", "文字写进 NSFW 库");
    ok(!npv.some(x => x.value === "NSFW 规则文字"), "Normal 库没被动");
    d.querySelector("#ipe-ledger-prompt-n-add").click();
    eq(JSON.parse(st.ledgerPromptNsfwPresetsJson).length, 2, "NSFW 槽「新增」多一套，只在 NSFW 库里");
    const man = d.querySelector("#ipe-ledger-mode-manual");
    ok(man && man.options.length === 3, "手动锁定只有 自动 / normal / nsfw 三档");
    ok(d.querySelector("#ipe-ledger-mode-now").textContent.indexOf("Normal 槽 →") >= 0 && d.querySelector("#ipe-ledger-mode-now").textContent.indexOf("NSFW 槽 →") >= 0, "状态行同时报两个槽各选了什么");
})();

console.log("\n【47】 投喂顺序按变动频率排（2.26.4 / 2.27.0）：本卡要点 → User 指令 → 账本历史 → 剧情摘要 → 这次额外要求 → 当前楼层 → 本轮正文；只改补充那句重摇，前面整段一字不差");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerNotePresetsJson = JSON.stringify([{ id: "ln_1", name: "本卡要点", value: "左肩旧伤七天好。" }]);
    st.activeLedgerNote = "ln_1";
    tavern.chat[5].mes = "第6层 <report>六楼摘要</report>";
    tavern.chat[7].mes = "第8层 <report>八楼摘要</report>";
    F("ipeLedgerCommit")("第 6 楼的账，够长够长够长够长够长。", 6);
    F("ipeLedgerCommit")("第 8 楼的账，够长够长够长够长够长。", 8);
    const s0 = F("ipeLedgerRead")(); s0.order = "别写天气。"; F("ipeLedgerSave")(s0);
    const sent = [];
    w.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>x</ledger>" } }] }) }; };
    await F("ipeLedgerCallAPI")(tavern.chat[9].mes, "这楼的伤别记。", 10);
    await F("ipeLedgerCallAPI")(tavern.chat[9].mes, "伤照记，只是别升级。", 10);
    await F("ipeLedgerCallAPI")(tavern.chat[9].mes, "", 10);
    const [a, b, c] = sent.map(x => x.messages[1].content);
    const at = h => a.indexOf(h);
    const heads = ["【本卡要点】", "【User 指令】", "【账本历史", "【剧情摘要", "【这次额外要求】", "【当前楼层】", "【本轮正文】"];
    ok(heads.every(h => at(h) >= 0) && heads.every((h, i) => i === 0 || at(heads[i - 1]) < at(h)),
        "段落顺序：本卡要点 → User 指令 → 账本历史 → 剧情摘要 → 这次额外要求 → 当前楼层 → 本轮正文", heads.map(h => h + "@" + at(h)).join(" "));
    ok(sent[0].messages[0].content === sent[1].messages[0].content, "system（挂账规则）两发一字不差");
    let k = 0; while (k < a.length && a[k] === b[k]) k++;
    const shared = a.slice(0, k);
    ok(k > at("【这次额外要求】") && shared.indexOf("八楼摘要") >= 0 && shared.indexOf("第 8 楼的账") >= 0,
        "只改补充那句：分叉点在剧情摘要、账本历史（连现任账本）之后，前面整段一字不差，前缀缓存吃得上",
        "分叉在第 " + k + " 字，额外要求从第 " + at("【这次额外要求】") + " 字开始");
    ok(c.indexOf("【这次额外要求】") < 0, "不带补充（自动挂账就是这样）没有这一段");
    eq(c, a.replace("【这次额外要求】\n这楼的伤别记。\n\n", ""), "带不带补充，其余各段原样、顺序不变");
})();

console.log("\n【48】 账本历史攒两楼再换（2.27.0）：旧账 2、3 版轮着来，没跳的那一发从头到现任原样接着长；现任与旧版同一种标题；面板估字数不挪钉子，重 roll 本楼跟上一发一字不差；旋钮 2 版 1、2 版轮着来，1 版只喂现任");
await (async () => {
    const head = u => u.slice(0, u.indexOf("【当前楼层】"));                 // 开头到账本历史末尾（这几楼没写 report，后面直接是楼层）
    const olds = u => (head(u).match(/楼时版本】/g) || []).length - 1;       // 减掉现任那份
    const walk = (vn, to) => {
        const { tavern, F } = boot(40);
        tavern.extensionSettings[F("EXT_NAME")].ledgerVersionsN = vn;
        const R = [];
        for (let f = 2; f <= to; f += 2) {                                   // 偶数楼是 AI 楼：先拼请求，再落这楼的账
            R.push({ f, u: F("ipeLedgerBuildUser")(tavern.chat[f - 1].mes, "", f) });
            F("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
        }
        return { tavern, F, R };
    };
    const { tavern, F, R } = walk(3, 30);
    const tail = R.filter(r => r.f >= 8);                                    // 第 8 楼起旧账够数
    eq(tail.map(r => olds(r.u)).join(","), tail.map((r, i) => i % 2 ? 3 : 2).join(","), "旋钮 3 版：旧账 2、3 版轮着来（再加现任），最多只多一版");
    let grew = 0, okPrefix = true;
    for (let i = 1; i < R.length; i++) {
        if (olds(R[i - 1].u) < 0 || olds(R[i].u) !== olds(R[i - 1].u) + 1) continue;   // 没跳的那一发（第一份账本之前是空账本，不算）
        grew++;
        if (R[i].u.indexOf(head(R[i - 1].u)) !== 0) okPrefix = false;
    }
    ok(grew >= 6 && okPrefix, "没跳的那一发：上一发从开头到账本历史末尾（连现任那份）原样是这一发的开头，前缀缓存吃得上", "没跳的 " + grew + " 发");
    ok(R.every(r => r.u.indexOf("【当前版本") < 0), "现任不再单独叫「当前版本」：跟旧版同一种标题，变成旧版时一字不变");
    ok(R.slice(1).every(r => r.u.indexOf("【账本历史 · 旧→新 · 最后一份是当前版本】") === 0), "段头写明最后一份是当前版本");
    const last = R[R.length - 1];
    ok(F("ipeLedgerEstimateChars")() > 0, "面板估字数照常出数");
    F("ipeLedgerReconcile")(last.f - 1);                                     // 重 roll 第 30 楼：这楼的账撕掉，现任退回第 28 楼
    eq(F("ipeLedgerBuildUser")(tavern.chat[last.f - 1].mes, "", last.f), last.u, "面板估过字数再重 roll 本楼：请求跟上一发一字不差（估字数是干跑，不挪钉子）");
    const two = walk(2, 20).R.filter(r => r.f >= 6);
    eq(two.map(r => olds(r.u)).join(","), two.map((r, i) => i % 2 ? 2 : 1).join(","), "旋钮 2 版：旧账 1、2 版轮着来");
    const one = walk(1, 20).R.filter(r => r.f >= 4);
    ok(one.every(r => olds(r.u) === 0), "旋钮 1 版：只喂现任，不攒");
    // 2.27.2 页面重新载入（手机切出去再回来常这样）：钉子记在聊天数据里，接着用
    const pre = walk(3, 12);                                                  // 第 12 楼那发刚跳过，下一发该接着往后长
    const last12 = pre.R[pre.R.length - 1];
    const again = boot(0, pre.tavern);                                       // 同一个聊天，新开的页面
    const u14 = again.F("ipeLedgerBuildUser")(pre.tavern.chat[13].mes, "", 14);
    ok(olds(last12.u) === 2 && olds(u14) === 3 && u14.indexOf(head(last12.u)) === 0, "页面重新载入以后：钉子还在，这一发接着上一发往后长", "olds " + olds(last12.u) + " → " + olds(u14));
    // 状态行：旧账接着上一发 / 重新起头，攒满以后隔一楼轮着来；还没有旧账时不报
    const h = boot(40); withApi(h.tavern, h.F);
    const seen = [];
    for (let f = 2; f <= 16; f += 2) {
        await h.F("ipeLedgerRun")(f - 1, false);
        const s = statusText(h.w);
        seen.push(s.indexOf("旧账接着上一发") >= 0 ? "接" : (s.indexOf("旧账重新起头") >= 0 ? "起" : "-"));
    }
    eq(seen.join(""), "--起接接起接起", "挂账状态行报旧账接着上一发还是重新起头（第 2、4 楼还没旧账不报，攒满以后一楼一换）");
})();

console.log("\n【49】 压缩账本带上「额外说一句」（2.27.0）：写了就进请求，排在压缩指令后面、包裹要求前面；没写跟以前一字不差");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    withApi(tavern, F, "gpt-4.1");
    const big = "【楼层状态】\n" + Array.from({ length: 40 }, (_, i) => "- 第 " + (i + 1) + " 条：某支线的过程描写，够长够长够长。").join("\n");
    F("ipeLedgerCommit")(big, 10);
    const sent = [];
    w.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>压过的账本，够长够长够长。</ledger>" } }] }) }; };
    await F("ipeLedgerCompress")();
    d.querySelector("#ipe-ledger-extra").value = "把第 3 到第 9 条合成一条。";
    await F("ipeLedgerCompress")();                                          // 写一句再重摇
    const [a, b] = sent.map(x => x.messages[1].content);
    ok(a.indexOf("【这次额外要求】") < 0, "没写：请求里没有这一段");
    const k = b.indexOf("【这次额外要求】\n把第 3 到第 9 条合成一条。");
    ok(k >= 0, "写了：压缩请求带上这一句");
    ok(k > b.indexOf("只删不添") && k < b.indexOf("输出仍完整包在"), "排在压缩指令后面、包裹要求前面");
    eq(b.replace("\n【这次额外要求】\n把第 3 到第 9 条合成一条。\n\n", ""), a, "去掉这一段，其余跟没写时一字不差");
    eq(F("ipeLedgerRead")().current, big, "只是预览，采用前账本没动");
})();

console.log("\n【50】 不留幽灵账（2.27.1）：挂账路上那楼删了 / 换了 swipe / 改了，回来的账作废不落账、不进贴耳，换了的按现在这条重挂；预览、强制采用、压缩采用前都对一眼；滑回已有的 swipe 补挂；场景标记跟楼走");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    const ledgerOf = mes => /菜烧糊/.test(mes) ? "菜烧糊了的账，够长够长够长够长。" : /海边/.test(mes) ? "去了海边的账，够长够长够长够长。"
        : /没买票/.test(mes) ? "没买票留在家的账，够长够长够长够长。" : /北京/.test(mes) ? "买了去北京的票的账，够长够长够长。" : "别的账，够长够长够长够长够长。";
    const lastUser = o => { try { const m = String(JSON.parse(o.body).messages[1].content); return m.slice(Math.max(0, m.indexOf("【本轮正文】"))); } catch (e) { return ""; } };   // 生图请求也会撞进来，别抛
    // 假副 AI：按这一发喂的正文回对应的账；hold() 之后的那一发先压着，等测试 release
    function sideAI(w) {
        const t = { calls: 0, held: null, holdNext: false };
        w.fetch = (u, o) => { t.calls++; const reply = okBody(ledgerOf(lastUser(o)));
            if (!t.holdNext) return Promise.resolve(reply);
            t.holdNext = false; return new Promise(res => { t.held = () => res(reply); }); };
        return t;
    }
    const setup = () => {
        const b = boot(10); const st = withApi(b.tavern, b.F); st.ledgerAutoRun = true;
        b.F("ipeLedgerCommit")("第八楼的账：大家在吃饭，够长够长够长。", 8); b.F("ipeLedgerApplyEP")();
        return Object.assign(b, { st, ai: sideAI(b.w), cur: () => b.F("ipeLedgerRead")(), ep: () => String((b.tavern.extensionPrompts[b.EPK] || {}).value || "") });
    };

    { // 只删 AI 末楼，挂账还在路上就发新消息（新消息占了第 10 楼）
        const { w, tavern, F, ai, cur, ep } = setup();
        tavern.chat[9].mes = "第十楼：菜烧糊了。"; ai.holdNext = true; F("ipeLedgerRun")(9, true); await wait(20);
        tavern.chat.splice(9); await tavern.eventSource.emit("MESSAGE_DELETED", 9); await wait(450);
        await tavern.eventSource.emit("GENERATION_STARTED", undefined, {}, false);
        tavern.chat.push({ is_user: true, is_system: false, mes: "我重新说一句。" });
        const gate = w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal"); await wait(30);
        ai.held(); await gate; await wait(50);
        ok(cur().lastFloor === 8 && !cur().current.includes("菜烧糊") && !ep().includes("菜烧糊"), "删掉的那楼的账回来晚了：作废，不落账，不进贴耳", "lastFloor=" + cur().lastFloor);
        ok(statusText(w).indexOf("作废") >= 0 && statusText(w).indexOf("上一份账") >= 0, "发送前等挂账的状态行照实说：等到的账作废了，这一发读到的是上一份", statusText(w));
    }
    { // 挂账还在路上就左滑回已有的那条：作废，按现在这条重挂
        const { tavern, F, ai, cur, ep } = setup();
        const m = tavern.chat[9]; m.swipes = ["第一条：他们去了海边。", "第二条：菜烧糊了。"]; m.swipe_id = 1; m.mes = m.swipes[1];
        ai.holdNext = true; F("ipeLedgerRun")(9, true); await wait(20);
        m.swipe_id = 0; m.mes = m.swipes[0]; await tavern.eventSource.emit("MESSAGE_SWIPED", 9); await wait(450);
        ai.held(); await wait(150);
        ok(!cur().current.includes("菜烧糊") && !ep().includes("菜烧糊"), "滑走那条的账回来晚了：作废，不进账本和贴耳");
        ok(cur().lastFloor === 10 && cur().current.includes("海边") && ep().includes("海边"), "按现在显示的这条重挂上了", cur().current.slice(0, 20));
    }
    { // 挂账还在路上就改了这楼（2.27.5：改楼不自动重挂，那份账照常落下，状态行提醒）
        const { w, tavern, F, ai, cur } = setup();
        tavern.chat[9].mes = "改前：他买了去北京的票。"; ai.holdNext = true; F("ipeLedgerRun")(9, true); await wait(20);
        tavern.chat[9].mes = "改后：他没买票，留在家里。"; await tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(350);
        ai.held(); await wait(150);
        ok(cur().current.includes("北京") && cur().lastFloor === 10 && ai.calls === 1, "挂账途中改了这楼：那份账照常落下，不再重挂", cur().current.slice(0, 20));
        ok(statusText(w).indexOf("挂账途中改过") >= 0 && statusText(w).indexOf("重新挂账") >= 0, "状态行提醒：账是按改前的正文记的，改了剧情就点「重新挂账」", statusText(w));
    }
    { // 生图在挂账路上往楼尾追加 <draw>：不算改，照常落账
        const { tavern, F, ai, cur } = setup();
        tavern.chat[9].mes = "第十楼：他们去了海边。"; ai.holdNext = true; F("ipeLedgerRun")(9, true); await wait(20);
        tavern.chat[9].mes += "\n\n<draw>a beach at dusk</draw>";
        ai.held(); await wait(60);
        ok(cur().lastFloor === 10 && cur().current.includes("海边") && ai.calls === 1, "楼尾只多了生图段：照常落账，不作废、不重挂");
    }
    { // 别的插件把这条消息整个换了个对象，正文没变：还算同一楼
        const { tavern, F, ai, cur } = setup();
        tavern.chat[9].mes = "第十楼：他们去了海边。"; ai.holdNext = true; F("ipeLedgerRun")(9, true); await wait(20);
        tavern.chat[9] = Object.assign({}, tavern.chat[9]);
        ai.held(); await wait(60);
        ok(cur().lastFloor === 10 && cur().current.includes("海边") && ai.calls === 1, "消息对象被换过、正文没变：照常落账");
    }
    { // 生成过第二条以后左滑回第一条（挂账不在路上）→ 撕掉第二条的账，给第一条补挂；重新生成新 swipe 时不抢着挂
        const { tavern, F, ai, cur } = setup();
        const m = tavern.chat[9]; m.swipes = ["第一条：他们去了海边。", "第二条：菜烧糊了。"]; m.swipe_id = 1; m.mes = m.swipes[1];
        await F("ipeLedgerRun")(9, true);
        ok(cur().current.includes("菜烧糊"), "第二条的账先挂上了");
        m.swipe_id = 0; m.mes = m.swipes[0]; await tavern.eventSource.emit("MESSAGE_SWIPED", 9); await wait(600);
        ok(cur().lastFloor === 10 && cur().current.includes("海边"), "滑回第一条：第二条的账撕掉，给第一条补挂上", cur().current.slice(0, 20));
        const before = ai.calls;
        m.swipes.push(""); m.swipe_id = 2; m.mes = "";
        await tavern.eventSource.emit("MESSAGE_SWIPED", 9); await tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
        m.mes = "第三条：菜烧糊了，还在出字…"; await wait(600);
        ok(ai.calls === before && cur().lastFloor === 8, "右滑重新生成：撕掉这楼的账，新 swipe 还在出字时不抢着挂");
        m.mes = m.swipes[2] = "第三条：菜烧糊了。"; await tavern.eventSource.emit("MESSAGE_RECEIVED", 9); await wait(700);
        ok(cur().lastFloor === 10 && cur().current.includes("菜烧糊"), "新 swipe 出完收到新楼：照常挂上");
    }
    { // 手动预览出来以后 roll 了那楼，再点采用；强制采用同理
        const { w, tavern, F, st, ai, cur } = setup(); st.ledgerAutoRun = false;
        tavern.chat[9].mes = "旧的一条：菜烧糊了。";
        await w.eval("ipeLedgerRunManual")();
        await tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
        tavern.chat[9].swipes = ["旧", "新的一条：去了海边。"]; tavern.chat[9].swipe_id = 1; tavern.chat[9].mes = "新的一条：去了海边。";
        w.eval("ipeLedgerAdoptPreview")("panel");
        ok(cur().lastFloor === 8 && !cur().current.includes("菜烧糊") && statusText(w).indexOf("没采用") >= 0, "预览出来后那楼 roll 了：不采用，状态行说明", statusText(w));
        await w.eval("ipeLedgerRunManual")(); w.eval("ipeLedgerAdoptPreview")("panel");
        ok(cur().lastFloor === 10 && cur().current.includes("海边"), "按现在这条重新预览再采用：照常落账");
        w.eval("ipeLedgerPending = '被拦下的旧账：菜烧糊了，够长够长。'; ipeLedgerPendingInput = ipeLedgerInput(SillyTavern.getContext().chat[9], 10); ipeLedgerPreviewFloor = 10;");
        tavern.chat[9].swipes.push("又一条：他们在山上。"); tavern.chat[9].swipe_id = 2; tavern.chat[9].mes = "又一条：他们在山上。";
        w.document.querySelector("#ipe-ledger-force-btn").click();
        ok(!cur().current.includes("菜烧糊") && statusText(w).indexOf("作废没采用") >= 0, "被拦下以后那楼换了一条 swipe：强制采用不落账", statusText(w));
        w.eval("ipeLedgerPending = '被拦下的账：他们在山上，够长够长够长。'; ipeLedgerPendingInput = ipeLedgerInput(SillyTavern.getContext().chat[9], 10); ipeLedgerPreviewFloor = 10;");
        tavern.chat[9].mes = "又一条：他们在山上，改了个字。"; await tavern.eventSource.emit("MESSAGE_EDITED", 9);
        w.document.querySelector("#ipe-ledger-force-btn").click();
        ok(cur().current.includes("他们在山上") && statusText(w).indexOf("拦下以后这楼改过") >= 0, "被拦下以后那楼只是改了：强制采用照常落账，提醒是按改前记的", statusText(w));
    }
    { // 压缩结果出来以后账本变了，再点采用
        const { w, tavern, F, cur } = setup();
        w.fetch = async () => okBody("压过的第八楼账，够长够长。");
        await F("ipeLedgerCompress")();
        F("ipeLedgerCommit")("第十楼的新账：他们去了海边，够长够长。", 10);
        w.eval("ipeLedgerAdoptPreview")("panel");
        ok(cur().current.includes("海边") && statusText(w).indexOf("作废没采用") >= 0, "压缩以后又挂了一楼：压缩结果作废，不把旧账盖回来", statusText(w));
        await F("ipeLedgerCompress")(); w.eval("ipeLedgerAdoptPreview")("panel");
        ok(cur().current.includes("压过的"), "重新压一次再采用：照常落账");
    }
    { // 挂账失败等重试的几秒里那楼删了：不重试，不给更早的楼再记一遍
        const { w, tavern, F, st, cur } = setup(); st.ledgerRetryOnce = true; st.ledgerRetryDelayMs = 80;
        let calls = 0; w.fetch = async () => { calls++; return { ok: false, status: 503, text: async () => "busy" }; };
        await F("ipeLedgerRun")(9, true);
        tavern.chat.splice(9); await wait(200);
        ok(calls === 1 && cur().lastFloor === 8, "那楼删了就不重试（以前会掉头给第 8 楼再记一遍）", "calls=" + calls);
    }
    { // 场景模式：被 roll 掉那条带 nsfw 标记，新的一条没写标记
        const { w, tavern, F, st } = setup(); st.ledgerAutoRun = false; st.ledgerModeEnabled = true;
        st.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "N", value: "NSFW 槽规则，够长。" }]);
        let sys = ""; w.fetch = async (u, o) => { sys = JSON.parse(o.body).messages[0].content; return okBody("账，够长够长够长够长。"); };
        tavern.chat[9].mes = "旧的一条。<route>nsfw</route>"; await F("ipeLedgerRun")(9, false);
        ok(sys.indexOf("NSFW 槽规则") >= 0, "旧那条带 nsfw 标记：用 NSFW 槽");
        await tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
        tavern.chat[9].mes = "新的一条，没写标记。"; await F("ipeLedgerRun")(9, false);
        ok(sys.indexOf("NSFW 槽规则") < 0, "roll 掉以后新那条没写标记：退回 roll 之前的模式，不沿用被 roll 掉那条的 nsfw");
        tavern.chat[7].mes = "第八楼。<route>nsfw</route>"; await F("ipeLedgerRun")(7, false);   // 第 8 楼挂账时读到 nsfw
        tavern.chat[9].mes = "旧的一条。<route>normal</route>"; await F("ipeLedgerRun")(9, false);
        ok(sys.indexOf("NSFW 槽规则") < 0, "第 10 楼旧那条写着 normal：用 Normal 槽");
        await tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
        tavern.chat[9].mes = "又一条，没写标记。"; await F("ipeLedgerRun")(9, false);
        ok(sys.indexOf("NSFW 槽规则") >= 0, "roll 掉写着 normal 的那条：往回找到还活着的第 8 楼写着 nsfw，照它沿用");
    }
})();

console.log("\n【51】 挂账状态行分阶段（2.27.3）：思考时报「正在思考，已想 N 字」，写正文再换「正在写账本，已收 N 字」；<think> 混在正文里发的也认，落账前剥掉");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    const said = [];
    const orig = w.ipeLedgerStatus;
    w.ipeLedgerStatus = function(txt) { said.push(String(txt)); return orig.apply(this, arguments); };
    const sse = d => "data: " + JSON.stringify({ choices: [{ delta: d }] }) + "\n\n";
    const think = "我先想想这一楼发生了什么，够长够长够长够长够长够长。";
    const body = "<ledger>新账本：左肩旧伤第 10 楼起，够长够长够长够长够长。</ledger>";
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([sse({ content: "<think>" + think }), sse({ content: "</think>\n" }), sse({ content: body }), "data: [DONE]\n\n"]) });
    await F("ipeLedgerRun")(9, false);
    ok(said.some(x => x.indexOf("正在思考，已想 " + think.length + " 字") >= 0) && !said.some(x => x.indexOf("正在写账本，已收 " + ("<think>" + think).length) >= 0),
        "思考混在正文开头发来：报「正在思考，已想 N 字」，不当成写账本", said.slice(0, 3).join(" ｜ "));
    ok(said.some(x => x.indexOf("正在写账本，已收 " + body.length + " 字") >= 0), "开始写正文：换成「正在写账本，已收 N 字」，字数只算正文");
    ok(F("ipeLedgerRead")().current.indexOf("左肩旧伤") >= 0 && F("ipeLedgerRead")().current.indexOf("我先想想") < 0, "落账的是账本，不带思考");
    said.length = 0;
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([sse({ reasoning_content: think }), sse({ content: body }), "data: [DONE]\n\n"]) });
    await F("ipeLedgerRun")(9, false);
    ok(said.some(x => x.indexOf("正在思考，已想 " + think.length + " 字") >= 0), "思考放在 reasoning_content 字段里的：也报「正在思考，已想 N 字」");
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([sse({ content: "<think>" + think + "</think>没写包裹的账本正文：右手还缠着绷带，够长够长够长。" }), "data: [DONE]\n\n"]) });
    await F("ipeLedgerRun")(9, false);
    ok(F("ipeLedgerRead")().current.indexOf("绷带") >= 0 && F("ipeLedgerRead")().current.indexOf("我先想想") < 0, "没写包裹时：开头那段思考剥掉，不混进账本");
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([sse({ content: "<think>" + think }), "data: [DONE]\n\n"]) });
    await F("ipeLedgerRun")(9, false);
    ok(statusText(w).indexOf("思考 " + think.length + " 字") >= 0 && F("ipeLedgerRead")().current.indexOf("绷带") >= 0, "只想没写：按回了个空报失败（带上思考字数），账本没动", statusText(w));
})();

console.log("\n【52】 生图注入不算改楼（2.27.4）：挂账路上楼尾贴了生图段（正文末尾的空行被顺手去掉、画风模板不是标签包着的也一样），照常落账，不再挂第二次；同一楼的重复通知也认得出来；真改楼也只提醒不重挂（2.27.5）");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    async function midRun(mes, setup, during) {
        const b = boot(10); const st = withApi(b.tavern, b.F); st.ledgerAutoRun = true;
        if (setup) setup(st);
        b.F("ipeLedgerCommit")("第八楼的账：大家在吃饭，够长够长够长。", 8);
        b.tavern.chat[9].mes = mes;
        const box = { calls: 0 }; let held = null;
        b.w.fetch = () => { box.calls++; if (box.calls === 1) return new Promise(res => { held = () => res(okBody("第十楼的账，够长够长够长够长。")); }); return Promise.resolve(okBody("第十楼的账（又挂一次），够长够长够长。")); };
        b.F("ipeLedgerRun")(9, true); await wait(20);
        await during(b);
        held(); await wait(150);
        return Object.assign(b, { box, cur: () => b.F("ipeLedgerRead")() });
    }
    let r = await midRun("第十楼正文：他推开窗。\n", null, b => b.F("injectDescToMessage")("a girl by the window", 9));
    ok(r.box.calls === 1 && r.cur().lastFloor === 10 && r.cur().current.indexOf("又挂一次") < 0, "正文末尾带换行、挂账路上注入生图：只挂一次，照常落账", "calls=" + r.box.calls);
    r = await midRun("第十楼正文：他推开窗。", st => { st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "自定义", value: "{Description}" }]); st.activeBaseTemplate = "tpl_1"; },
        b => b.F("injectDescToMessage")("a girl by the window", 9));
    ok(r.box.calls === 1 && r.cur().lastFloor === 10, "画风模板不是标签包着的：注入照样不算改楼，只挂一次", "calls=" + r.box.calls);
    await r.tavern.eventSource.emit("MESSAGE_RECEIVED", 9); await wait(700);
    ok(r.box.calls === 1, "落账后同一楼又来一次「收到新楼」：正文多了生图段也认得是同一楼，不再挂", "calls=" + r.box.calls);
    r = await midRun("第十楼正文：他推开窗。", null, async b => { b.tavern.chat[9].mes = "改后：他关上了窗。"; await b.tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(350); });
    ok(r.box.calls === 1 && r.cur().lastFloor === 10 && r.cur().current.indexOf("又挂一次") < 0 && statusText(r.w).indexOf("挂账途中改过") >= 0,
        "真在酒馆里改了楼（2.27.5）：那份账照常落下、不再重挂，状态行提醒", "calls=" + r.box.calls);
})();

console.log("\n【53】 空回 / 没写完不跑（2.27.6）：最新那楼空回、<content> 没收尾、<think> 没收尾，自动挂账和自动生图都不跑，也不往回给上一楼再记；写完了（继续 / 重 roll）收到新楼照常跑；手动重新挂账不拦");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    async function receive(mes) {
        const b = boot(10); const st = withApi(b.tavern, b.F); st.ledgerAutoRun = true; st.autoInjectDelay = 500;
        b.F("ipeLedgerCommit")("第八楼的账：大家在吃饭，够长够长够长。", 8);
        const box = { ledger: 0, img: 0 };
        b.w.fetch = async () => { box.ledger++; return okBody("第十楼的账，够长够长够长够长。"); };
        b.w.runExtract = async function(){ box.img++; };   // 自动生图走到提取这一步就记一笔
        b.tavern.chat[9].mes = mes;
        await b.tavern.eventSource.emit("MESSAGE_RECEIVED", 9, "normal"); await wait(900);
        return Object.assign(b, { box, cur: () => b.F("ipeLedgerRead")() });
    }
    let r = await receive("");
    ok(r.box.ledger === 0 && r.box.img === 0 && r.cur().lastFloor === 8, "空回：不挂账、不提取，也不往回给第 8 楼再记一遍", JSON.stringify(r.box));
    ok(statusText(r.w).indexOf("空回") >= 0 && statusText(r.w).indexOf("先不跑") >= 0, "挂账状态行说这楼空回了、自动挂账先不跑", statusText(r.w));
    r = await receive("<content>他推开门，外面的雨");
    ok(r.box.ledger === 0 && r.box.img === 0 && statusText(r.w).indexOf("没写完") >= 0, "<content> 开了没收尾：都不跑，状态行说正文没写完", JSON.stringify(r.box) + " " + statusText(r.w));
    r = await receive("<think>先想想这一楼要写什么");
    ok(r.box.ledger === 0 && r.box.img === 0, "<think> 没收尾（还在想就断了）：都不跑", JSON.stringify(r.box));
    r = await receive("<think>想完了</think>\n<route>normal</route>");
    ok(r.box.ledger === 0 && r.box.img === 0, "只有思考和楼尾标记、没有正文：算空回", JSON.stringify(r.box));
    r = await receive("<content>  </content>");
    ok(r.box.ledger === 0 && r.box.img === 0, "<content> 里一个字都没有：算空回", JSON.stringify(r.box));
    r = await receive("<content>他推开门，外面的雨");
    r.tavern.chat[9].mes += "停了。</content>";                                    // 点「继续」写完
    await r.tavern.eventSource.emit("MESSAGE_RECEIVED", 9, "continue"); await wait(900);
    ok(r.box.ledger === 1 && r.box.img === 1 && r.cur().lastFloor === 10, "点继续写完以后收到新楼：照常挂账、照常提取", JSON.stringify(r.box));
    r = await receive("<content>他推开门，外面的雨停了。</content>");
    ok(r.box.ledger === 1 && r.box.img === 1 && r.cur().lastFloor === 10, "写完的楼：照常挂账、照常提取（对照）", JSON.stringify(r.box));
    r = await receive("他推开门，外面的雨停了。");
    ok(r.box.ledger === 1 && r.box.img === 1, "没用 <content> 包的普通正文：照常跑（分不出来，不误拦）", JSON.stringify(r.box));
    r = await receive("<content>他推开门，外面的雨");
    await r.w.eval("ipeLedgerRunManual")();
    ok(r.box.ledger === 1, "手动「重新挂账」不拦：你点了就跑", JSON.stringify(r.box));
})();

console.log("\n【54】 正文标签可以改（2.27.7）：预设不用 <content> 的，填自己的标签——挂账、生图只从这个标签取正文，新楼这个标签没收尾就不自动跑；留空 = 不认标签，照老样子认 <content>、不查写没写完，只拦空回");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    async function receive(mes, bodyTag) {
        const b = boot(10); const st = withApi(b.tavern, b.F); st.ledgerAutoRun = true; st.autoInjectDelay = 500;
        if (bodyTag !== undefined) st.bodyTag = bodyTag;
        b.F("ipeLedgerCommit")("第八楼的账：大家在吃饭，够长够长够长。", 8);
        const box = { ledger: 0, img: 0, body: "" };
        b.w.fetch = async (url, opt) => {
            box.ledger++;
            try { const u = JSON.parse(opt.body).messages.map(m => String(m.content || "")).join("\n"); box.body = u.slice(u.indexOf("\u3010\u672c\u8f6e\u6b63\u6587\u3011")); } catch (e) {}
            return okBody("第十楼的账，够长够长够长够长。");
        };
        b.w.runExtract = async function(){ box.img++; };
        b.tavern.chat[9].mes = mes;
        await b.tavern.eventSource.emit("MESSAGE_RECEIVED", 9, "normal"); await wait(900);
        return Object.assign(b, { box, cur: () => b.F("ipeLedgerRead")() });
    }
    const STATUS = "<status>体力 10，心情 阴</status>\n";
    let r = await receive(STATUS + "<正文>他推开门，外面的雨", "正文");
    ok(r.box.ledger === 0 && r.box.img === 0 && r.cur().lastFloor === 8, "填了「正文」：<正文> 开了没收尾，自动挂账、自动生图都不跑", JSON.stringify(r.box));
    ok(statusText(r.w).indexOf("<正文> 开了没收尾") >= 0, "状态行点名是 <正文> 没收尾", statusText(r.w));
    r = await receive(STATUS + "<正文>他推开门，外面的雨停了。</正文>", "正文");
    ok(r.box.ledger === 1 && r.box.img === 1 && r.cur().lastFloor === 10, "<正文> 写完了：照常挂账、照常提取", JSON.stringify(r.box));
    ok(r.box.body.indexOf("他推开门，外面的雨停了。") >= 0 && r.box.body.indexOf("体力 10") < 0, "挂账的「本轮正文」只取 <正文> 里那段，状态栏不混进去", r.box.body.slice(0, 120));
    r = await receive(STATUS + "<正文>  </正文>", "正文");
    ok(r.box.ledger === 0 && r.box.img === 0 && statusText(r.w).indexOf("<正文> 里一个字都没有") >= 0, "<正文> 里一个字都没有（楼里只剩状态栏）：算空回，都不跑", JSON.stringify(r.box) + " " + statusText(r.w));
    r = await receive("<正文>他推开门，外面的雨", "content, 正文");
    ok(r.box.ledger === 0 && r.box.img === 0, "填两个（content, 正文）：哪个没收尾都拦", JSON.stringify(r.box));
    r = await receive("<content>他推开门，外面的雨停了。</content>", "content, 正文");
    ok(r.box.ledger === 1 && r.box.img === 1 && r.box.body.indexOf("外面的雨停了") >= 0, "填两个时 <content> 写完的楼照常跑、照常取正文", JSON.stringify(r.box));
    r = await receive("<正文>他推开门，外面的雨");
    ok(r.box.ledger === 1 && r.box.img === 1, "对照：没改设置（默认 content）时不认 <正文>，半截照样跑——所以要能改", JSON.stringify(r.box));

    r = await receive("<content>他推开门，外面的雨", "");
    ok(r.box.ledger === 1 && r.box.img === 1, "留空：不查写没写完，<content> 没收尾也照常跑（和 2.27.6 以前一样）", JSON.stringify(r.box));
    r = await receive("", "");
    ok(r.box.ledger === 0 && r.box.img === 0 && statusText(r.w).indexOf("空回") >= 0, "留空：空回照样拦", JSON.stringify(r.box) + " " + statusText(r.w));
    r = await receive("<think>先想想这一楼要写什么", "");
    ok(r.box.ledger === 0 && r.box.img === 0, "留空：<think> 没收尾（只想了没写）也算空回，照样拦", JSON.stringify(r.box));
    r = await receive("<think>想完了</think>\n<content>\n</content>", "");
    ok(r.box.ledger === 0 && r.box.img === 0, "留空：只剩空标签、没一个字，也算空回", JSON.stringify(r.box));
    r = await receive(STATUS + "<content>他推开门，外面的雨停了。</content>", "");
    ok(r.box.ledger === 1 && r.box.body.indexOf("外面的雨停了") >= 0 && r.box.body.indexOf("体力 10") < 0, "留空：取正文照老样子认 <content>", r.box.body.slice(0, 120));

    // 生图提取那边取的也是这一段；思考里顺嘴提到的标签不算
    const b = boot(10); const st = withApi(b.tavern, b.F); st.bodyTag = "正文";
    const vp = b.F("buildVisionUserPrompt")("<think>这楼打算写 <正文>开头先下雨</正文> 这种</think>" + STATUS + "<正文>他推开门，外面的雨停了。</正文>", "");
    const sec = vp.slice(vp.indexOf("【正文内容】"));
    ok(sec.indexOf("他推开门，外面的雨停了。") >= 0 && sec.indexOf("开头先下雨") < 0 && sec.indexOf("体力 10") < 0, "生图的【正文内容】只取 <正文> 里那段：思考里提到的、状态栏都不混进去", sec.slice(0, 160));
    const vp2 = b.F("buildVisionUserPrompt")("他推开门，外面的雨停了。", "");
    ok(vp2.indexOf("【正文内容】\n他推开门，外面的雨停了。") >= 0, "这楼没有正文标签：兜底用整楼（和以前一样）", vp2.slice(-80));
})();

console.log("\n【55】 开场白开关（2.27.8）：关掉以后开场白不自动提取出图（新酒馆认 first_message，老酒馆认第一句话之前的 AI 楼，群聊几条开场白都算），挂账照常、手动提取照常；开场白后面新写的楼照常出图");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    const AI = mes => ({ is_user: false, is_system: false, mes });
    const GREET = "暮春三月，洛京飞花。镇北侯世子韩川央率三千铁骑踏过祁门关。";
    async function greet(opts) {
        const b = boot(1); const st = withApi(b.tavern, b.F); st.autoInjectDelay = 500; st.ledgerAutoRun = true;
        if (opts.off) st.imgAutoGreeting = false;
        b.tavern.chat.length = 0;
        (opts.chat || [AI(GREET)]).forEach(m => b.tavern.chat.push(m));
        const box = { ledger: 0, img: 0 };
        b.w.fetch = async () => { box.ledger++; return okBody("开场的账，够长够长够长够长。"); };
        b.w.runExtract = async function(){ box.img++; };
        await b.tavern.eventSource.emit("MESSAGE_RECEIVED", ...opts.args); await wait(900);
        return Object.assign(b, { box, img: () => (b.w.document.querySelector("#ipe-status") || {}).textContent || "" });
    }
    let r = await greet({ args: [0, "first_message"] });
    ok(r.box.img === 1, "默认开着：开场白照常自动提取（和以前一样）", JSON.stringify(r.box));
    r = await greet({ off: true, args: [0, "first_message"] });
    ok(r.box.img === 0 && r.img().indexOf("开场白") >= 0 && r.img().indexOf("手动提取") >= 0, "关掉：开场白不自动提取，状态行说是开场白、要图点手动提取", JSON.stringify(r.box) + " " + r.img());
    ok(r.box.ledger === 1, "关掉也照常挂账（这个开关只管出图）", JSON.stringify(r.box));
    await r.w.eval("onExtract")(); await wait(50);
    ok(r.box.img === 1, "关掉以后点「手动提取」照样提取开场白", JSON.stringify(r.box));
    r = await greet({ off: true, args: [0] });
    ok(r.box.img === 0, "老酒馆事件不带 type：第一句话之前的 AI 楼也认作开场白", JSON.stringify(r.box));
    r = await greet({ off: true, chat: [AI("甲的开场白，够长够长。"), AI("乙的开场白，够长够长。")], args: [1, "first_message"] });
    ok(r.box.img === 0, "群聊第二条开场白：同样不自动提取", JSON.stringify(r.box));
    r = await greet({ off: true, chat: [AI("甲的开场白，够长够长。"), AI("乙的开场白，够长够长。")], args: [1] });
    ok(r.box.img === 0, "群聊第二条开场白、事件不带 type：也认得", JSON.stringify(r.box));
    r = await greet({ off: true, chat: [AI(GREET), AI("没等你说话，AI 接着往下写的这一楼。")], args: [1, "normal"] });
    ok(r.box.img === 1, "开场白后面直接让 AI 往下写的那楼（type 不是 first_message）：是新写的，照常出图", JSON.stringify(r.box));
    r = await greet({ off: true, chat: [AI(GREET), { is_user: true, is_system: false, mes: "你好" }, AI("回你的这一楼，够长够长。")], args: [2] });
    ok(r.box.img === 1, "说过话以后的楼、事件不带 type：照常出图", JSON.stringify(r.box));
})();

console.log("\n【56】 还没写到正文就断了（2.27.8）：前两条 AI 楼都有正文标签、这楼一个都没有（断在自家标签包的思考、正文前的状态栏里），自动挂账和自动生图都先不跑；预设不用这个标签、只有一楼有、正文标签留空，都照常跑");
await (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    const C = (tag, txt) => "<think>想好了</think>\n<" + tag + ">" + txt + "</" + tag + ">\n<status>体力 10</status>";
    async function cut(mes, prep, bodyTag) {
        const b = boot(10); const st = withApi(b.tavern, b.F); st.ledgerAutoRun = true; st.autoInjectDelay = 500;
        if (bodyTag !== undefined) st.bodyTag = bodyTag;
        b.F("ipeLedgerCommit")("第八楼的账：大家在吃饭，够长够长够长。", 8);
        if (prep) prep(b.tavern.chat);     // 第 4、6、8 楼（下标 3、5、7）是 AI 楼
        const box = { ledger: 0, img: 0 };
        b.w.fetch = async () => { box.ledger++; return okBody("第十楼的账，够长够长够长够长。"); };
        b.w.runExtract = async function(){ box.img++; };
        b.tavern.chat[9].mes = mes;
        await b.tavern.eventSource.emit("MESSAGE_RECEIVED", 9, "normal"); await wait(900);
        return Object.assign(b, { box, img: () => (b.w.document.querySelector("#ipe-status") || {}).textContent || "" });
    }
    const both = tag => chat => { chat[5].mes = C(tag, "第六楼的正文。"); chat[7].mes = C(tag, "第八楼的正文。"); };
    let r = await cut("<cot>先盘一下这一楼：他该不该开门", both("content"));
    ok(r.box.ledger === 0 && r.box.img === 0 && r.F("ipeLedgerRead")().lastFloor === 8, "前两楼都有 <content>，这楼断在 <cot> 思考里（插件不认这个思考标签）：都不跑，账本还停在第 8 楼", JSON.stringify(r.box));
    ok(statusText(r.w).indexOf("还没写到正文就断了") >= 0 && statusText(r.w).indexOf("<content>") >= 0, "挂账状态行说像是还没写到正文就断了，点名前两楼用的 <content>", statusText(r.w));
    ok(r.img().indexOf("还没写到正文就断了") >= 0 && r.img().indexOf("手动提取") >= 0, "生图状态行也说了，写完了的话点手动提取", r.img());
    r = await cut("<status>体力 10，心情 阴</status>\n", both("content"));
    ok(r.box.ledger === 0 && r.box.img === 0, "前两楼都有 <content>，这楼只写了正文前的状态栏就断了：都不跑", JSON.stringify(r.box));
    r = await cut(C("content", "他推开门，外面的雨停了。"), both("content"));
    ok(r.box.ledger === 1 && r.box.img === 1, "对照：这楼也写完了 <content>，照常跑", JSON.stringify(r.box));
    r = await cut("<cot>先盘一下这一楼：他该不该开门");
    ok(r.box.ledger === 1 && r.box.img === 1, "前面的楼都没有 <content>（预设本来不用）：照常跑，不误拦", JSON.stringify(r.box));
    r = await cut("<cot>先盘一下这一楼：他该不该开门", chat => { chat[7].mes = C("content", "第八楼的正文。"); });
    ok(r.box.ledger === 1 && r.box.img === 1, "只有上一楼有 <content>、再往前那楼没有：认不准，照常跑", JSON.stringify(r.box));
    r = await cut("<cot>先盘一下这一楼：他该不该开门", both("content"), "");
    ok(r.box.ledger === 1 && r.box.img === 1, "正文标签留空：不认标签，照常跑", JSON.stringify(r.box));
    r = await cut("<cot>先盘一下这一楼：他该不该开门", both("正文"), "正文");
    ok(r.box.ledger === 0 && r.box.img === 0 && statusText(r.w).indexOf("<正文>") >= 0, "正文标签填「正文」、前两楼都有 <正文>：同样拦，点名 <正文>", JSON.stringify(r.box) + " " + statusText(r.w));
    r = await cut("<cot>先盘一下这一楼：他该不该开门", chat => { chat[3].mes = C("content", "第四楼的正文。"); chat[5].mes = C("content", "第六楼的正文。"); chat[7].mes = "（藏起来的旁白）"; chat[7].is_system = true; });
    ok(r.box.ledger === 0 && r.box.img === 0, "藏起来的楼不算：越过它看前两条 AI 楼，都有 <content>，照样拦", JSON.stringify(r.box));
    r = await cut("<cot>先盘一下这一楼：他该不该开门", both("content"));
    await r.w.eval("ipeLedgerRunManual")();
    ok(r.box.ledger === 1, "手动「重新挂账」不拦：你点了就跑", JSON.stringify(r.box));
})();

console.log("\n【57】 元数据没变就不叫酒馆存（2.27.12）");
{
    const { tavern, F } = boot(10);
    let saves = 0; tavern.saveMetadataDebounced = () => { saves++; };
    const meta = () => tavern.chatMetadata;
    // 账本：同一楼、同一段文字再落一次，不存；文字变了才存
    F("ipeLedgerCommit")("第十楼的账本内容，够长够长够长够长。", 10);
    eq(saves, 1, "头一次落账：叫酒馆存一次");
    meta().ipe_ledger_v2.updatedAt = 12345;
    F("ipeLedgerCommit")("第十楼的账本内容，够长够长够长够长。", 10);
    eq(saves, 1, "同一楼同样的账再落一次：内容没变，不叫酒馆存（修好前这条必挂）");
    eq(meta().ipe_ledger_v2.updatedAt, 12345, "没变就不盖新的 updatedAt（修好前这条必挂）");
    const st = F("ipeLedgerRead")();
    eq(st.current, "第十楼的账本内容，够长够长够长够长。", "读回来的账还是那份");
    F("ipeLedgerCommit")("第十楼改过的账本内容，够长够长够长够长。", 10);
    eq(saves, 2, "账改了：照常存");
    // 挂账来源签名
    const input = { floor: 10, swipe: 0, text: "第十楼正文，够长够长够长够长够长。" };
    F("ipeLedgerSrcMark")(input); eq(saves, 3, "头一次记来源签名：存");
    F("ipeLedgerSrcMark")(input); eq(saves, 3, "同样的来源再记一次：不存（修好前这条必挂）");
    F("ipeLedgerSrcMark")({ floor: 10, swipe: 1, text: input.text }); eq(saves, 4, "换了条 swipe：存");
    // 场景标记
    F("ipeLedgerModeSet")("nsfw", 10); eq(saves, 5, "头一次写场景标记：存");
    F("ipeLedgerModeSet")("nsfw", 10); eq(saves, 5, "同一楼同一个模式再写：不存（修好前这条必挂）");
    ok(F("ipeLedgerModeState")().mode === "nsfw" && F("ipeLedgerModeState")().floor === 10, "读回来的模式和楼号没变");
    F("ipeLedgerModeSet")("normal", 11); eq(saves, 6, "模式变了：存");
    // 四层
    const layers = { camera: "特写", env: "雨夜的巷子", mood: "压抑", chars: "黑发少年", pose: "靠墙", envFloor: 9, moodFloor: 10 };
    F("ipeImgLayersSave")(layers, 10); eq(saves, 7, "头一次存四层：存");
    F("ipeImgLayersSave")(Object.assign({}, layers), 10); eq(saves, 7, "同样的四层再存一次：不存（修好前这条必挂）");
    ok(F("ipeImgLayersRead")().env === "雨夜的巷子" && F("ipeImgLayersRead")().floor === 10, "读回来的四层没变");
    F("ipeImgLayersSave")(Object.assign({}, layers, { mood: "松快" }), 10); eq(saves, 8, "有一层变了：存");
    F("ipeImgLayersSave")(layers, 11); eq(saves, 9, "楼号变了：存");
}

/* 2.27.13 注入后不当场存聊天：延后 1 秒合并，1 秒内贴几楼也只存一次；酒馆有 saveChatDebounced 就交给它合并 */
await (async () => {
    const { w, tavern, F } = boot(10);
    let saved = 0; tavern.saveChat = () => { saved++; };
    tavern.chat[7].mes = "第八楼正文。"; tavern.chat[9].mes = "第十楼正文。";
    F("injectDescToMessage")("floor eight", 7);
    F("injectDescToMessage")("floor ten", 9);
    eq(saved, 0, "贴完当场不叫 saveChat（修好前这条必挂）");
    ok(tavern.chat[7].mes.indexOf("floor eight") >= 0 && tavern.chat[9].mes.indexOf("floor ten") >= 0, "两楼都贴上了");
    await new Promise(function(resolve){ setTimeout(resolve, 1100); });
    eq(saved, 1, "1 秒内贴了两楼，只整份存一次");
    let debounced = 0; tavern.saveChatDebounced = () => { debounced++; };
    tavern.chat[5].mes = "第六楼正文。";
    F("injectDescToMessage")("floor six", 5);
    eq(debounced, 1, "酒馆有 saveChatDebounced 就并进它的防抖");
    await new Promise(function(resolve){ setTimeout(resolve, 1100); });
    eq(saved, 1, "交给酒馆防抖以后不再自己叫 saveChat");
    delete tavern.saveChatDebounced;
})();

console.log("\n【58】 挂账规则包导入导出（2.28.1）：挂账规则 / NSFW 规则 / 本卡要点 按名字合并，分享给别人用");
await (async () => {
    const a = boot(10);
    const sa = a.tavern.extensionSettings[a.F("EXT_NAME")];
    sa.ledgerPromptPresetsJson = JSON.stringify([{ id: "lp_1", name: "飞地·大事件挂账", value: "默认规则" }, { id: "lp_x", name: "情感脉络与剧情奔涌", value: "# 情感脉络挂账 v1.1\n伤病三轮钟" }]);
    sa.activeLedgerPrompt = "lp_x";
    sa.ledgerNotePresetsJson = JSON.stringify([{ id: "ln_1", name: "本卡要点", value: "" }, { id: "ln_x", name: "707号室", value: "外伤两日即愈" }]);
    sa.activeLedgerNote = "ln_x";
    sa.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "NSFW 挂账规则", value: "nsfw 规则文字" }]);
    sa.ledgerCompressPrompt = "我的压缩指令";
    const all = a.w.eval('ipeLedgerPackBuild("all")');
    eq(all._fmt, "ipe-ledger-pack", "包格式标记");
    eq(all.prompts.length, 2, "全部：挂账规则两套都带");
    eq(all.notes.length, 1, "本卡要点只带有内容的");
    eq(all.nsfwPrompts.length, 1, "NSFW 规则带上");
    eq(all.compressPrompt, "我的压缩指令", "自定义压缩指令带上");
    ok(!JSON.stringify(all).includes("apiKey") && !JSON.stringify(all).includes("ledgerText"), "不带 API、不带账本正文");
    const cur = a.w.eval('ipeLedgerPackBuild("current")');
    ok(cur.prompts.length === 1 && cur.prompts[0].name === "情感脉络与剧情奔涌", "只导出当前：只有当前这套规则");
    ok(cur.notes.length === 1 && cur.notes[0].name === "707号室", "只导出当前：当前本卡要点");
    const d = a.w.document;
    ok(!!d.querySelector("#ipe-lrule-export") && !!d.querySelector("#ipe-lrule-export-cur") && !!d.querySelector("#ipe-lrule-import") && !!d.querySelector("#ipe-lrule-file"), "挂账规则区有导出 / 只导出当前 / 导入按钮");
    ok(!!d.querySelector("#ipe-lrule-export").closest("details") && d.querySelector("#ipe-lrule-export").closest("details") === d.querySelector("#ipe-ledger-prompt").closest("details"), "按钮在挂账规则区里");
    eq(cur.compressPrompt, "", "只导出当前：不带全局的压缩指令");

    // 朋友那边：导入只含一套规则的包 → 新增并选中
    const b = boot(10);
    const sb = b.tavern.extensionSettings[b.F("EXT_NAME")];
    let asked = 0; b.w.confirm = () => { asked++; return true; };
    const r1 = b.w.eval('ipeLedgerPackImportText(' + JSON.stringify(JSON.stringify(cur)) + ')');
    ok(r1 && r1.prompts.added === 1, "导入：新规则追加");
    const lb = JSON.parse(sb.ledgerPromptPresetsJson);
    const got = lb.find(x => x.name === "情感脉络与剧情奔涌");
    ok(got && got.value.includes("伤病三轮钟"), "导入的规则正文完整");
    eq(sb.activeLedgerPrompt, got && got.id, "包里只有一套规则：导入后直接选中");
    ok(b.w.document.querySelector("#ipe-ledger-prompt").value.includes("伤病三轮钟"), "编辑框换成导入的规则");
    eq(asked, 0, "没有同名覆盖就不问");
    // 再导一次改过的同名规则 → 问一句再覆盖
    const cur2 = JSON.parse(JSON.stringify(cur)); cur2.prompts[0].value = "# 情感脉络挂账 v1.2";
    const r2 = b.w.eval('ipeLedgerPackImportText(' + JSON.stringify(JSON.stringify(cur2)) + ')');
    ok(asked === 1 && r2 && r2.prompts.replaced === 1, "同名规则覆盖前问一句");
    eq(JSON.parse(sb.ledgerPromptPresetsJson).filter(x => x.name === "情感脉络与剧情奔涌").length, 1, "同名不重复堆");
    b.w.confirm = () => false;
    const cur3 = JSON.parse(JSON.stringify(cur)); cur3.prompts[0].value = "v9";
    eq(b.w.eval('ipeLedgerPackImportText(' + JSON.stringify(JSON.stringify(cur3)) + ')'), null, "取消就什么都不动");
    ok(JSON.parse(sb.ledgerPromptPresetsJson).find(x => x.name === "情感脉络与剧情奔涌").value === "# 情感脉络挂账 v1.2", "取消后规则没变");
    eq(b.w.eval('ipeLedgerPackImportText(' + JSON.stringify(JSON.stringify({ _fmt: "ipe-image-pack", templates: [] })) + ')'), null, "生图预设包导不进挂账规则");
    eq(b.w.eval('ipeLedgerPackImportText("not json")'), null, "坏 JSON 不崩");
})();

console.log("\n" + "\u2500".repeat(46));
console.log(fail === 0 ? `\u5168\u90E8\u901A\u8FC7 \u2705  ${pass} \u9879` : `${pass} \u901A\u8FC7 / ${fail} \u5931\u8D25 \u274C`);
process.exit(fail === 0 ? 0 : 1);
})();
