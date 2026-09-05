/* 小海螺 · 挂账管线 E2E 流程测试
   跑法：node ledger.test.js
   只测状态与顺序，不碰真 API。重点是 2.8.1 那个抢跑 bug：
   单元测试测不出来——每个函数单看都对，错的是事件与组 prompt 的先后。 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(path.join(__dirname, "../ipe-image-prompt-extractor-main/index.js"), "utf8");

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
            MESSAGE_DELETED: "MESSAGE_DELETED", CHAT_CHANGED: "CHAT_CHANGED"
        },
        chatMetadata: {},
        getCurrentChatId() { return "test-chat"; },
        setExtensionPrompt(key, value, pos, depth, scan, role) {
            extensionPrompts[key] = { value, position: pos, depth, role };
        },
        saveMetadataDebounced() {}, saveSettingsDebounced() {},
        extensionSettings: {}, extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }
    };
}

/* ---- 把 index.js 装进 jsdom，抠出内部函数 ---- */
function boot(floors) {
    const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "outside-only", url: "http://localhost" });
    const w = dom.window;
    const tavern = makeTavern(floors);
    w.SillyTavern = { getContext: () => tavern };
    w.toastr = { error() {}, success() {}, warning() {}, info() {} };
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;   // jsdom 没带，流式解码要用
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>新账本正文，够长够长够长够长够长够长够长。</ledger>" } }] }) });

    const exposed = ["ipeLedgerRead", "ipeLedgerSave", "ipeLedgerCommit", "ipeLedgerReconcile",
        "ipeFloorNo", "ipeLedgerApplyEP", "ipeLedgerNormalize", "ipeLedgerStop",
        "ipeLedgerIsAbort", "ipeLedgerExport", "ipeLedgerImportText", "ipeLedgerInspectEP",
        "EXT_NAME", "DEFAULTS", "IPE_LEDGER_EP_KEY", "init", "ipeLedgerStripImageTag", "ipeLedgerBuildUser", "ipeLedgerReportBlock", "ipeLedgerPruneMirror",
        "ipeLedgerRun", "ipeLedgerCallAPI", "ipeLedgerReadStream", "ipeLedgerIsReasoningModel",
        "runExtract", "ipeImgParseLayers", "buildInjectTag", "buildVisionUserPrompt", "ipeImgLayersRead", "onRerollLayer",
        "ipeInstallZoomButtons", "ipeZoomOpen", "ipeZoomClose", "ipeZoomTitleFor",
        "ipeImgPackBuild", "ipeImgPackImportText", "ipeGetBaseTemplates", "ipeGetRulePresets", "ipeGetSystemPromptPresets", "ipeGetAnchorPresets", "ipeGetAnchorUsageGuide"];
    const shim = SRC + "\n;(function(){ " +
        exposed.map(n => `try{ window.__t_${n} = ${n}; }catch(e){}`).join(" ") +
        " try{ window.__t_failStreak = function(){ return ipeLedgerFailStreak; }; }catch(e){}" +
        " })();";
    try { w.eval(shim); } catch (e) { console.log("装载失败：" + e.message); }
    const F = n => w["__t_" + n];
    // 事件绑定藏在 createUI() 里，由 APP_READY 触发——不发这个事件，什么都没绑上
    tavern.extensionSettings[F("EXT_NAME")] = Object.assign({}, F("DEFAULTS"));
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
}


console.log("\n\u301010\u3011 生图 tag 剥离（2.9.2）");
{
    const { tavern, F } = boot(10);
    const strip = F("ipeLedgerStripImageTag");
    eq(strip("正文。\n\nimage###a girl###"), "正文。", "默认模板 前后缀都有：整段剥掉");
    eq(strip("正文里提到 image###x### 这种写法。\n\nimage###real###"), "正文里提到 这种写法。", "前后缀齐全时按对剥（与旧行为一致）");
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
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['{"choices":[{"message":{"content":"<ledger>整包回来的账本，够长够长够长够长够长够长。</ledger>"}}]}']) });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("整包回来") >= 0, "非 SSE 的 JSON 一样落账");
    // 老测试桩：response 没有 body 只有 text()，也要能走通（默认就是流式开）
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>只有 text() 的桩，够长够长够长够长够长够长。</ledger>" } }] }) });
    await F("ipeLedgerRun")(9, true);
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
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    let sent = null;
    const okStream = () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>上限测试账本，够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return okStream(); };
    await F("ipeLedgerRun")(9, true);
    ok(!("max_tokens" in sent) && !("max_completion_tokens" in sent), "默认 0：两种都不发");
    st.ledgerMaxTokens = 16000;
    await F("ipeLedgerRun")(9, true);
    eq(sent.max_completion_tokens, 16000, "gpt-5 → max_completion_tokens");
    ok(!("max_tokens" in sent), "gpt-5 不发 max_tokens");
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: "gpt-4.1" }]);
    await F("ipeLedgerRun")(9, true);
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

console.log("\n【26】 模板占位符：{Env} {Pose} 单放，{Description} 拿剩下的；老模板照旧");
{
    const { tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const layers = { camera: "CAM", env: "ENV", chars: "CHR", pose: "POS" };
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "分层", value: "scene: {Env} | action: {Pose} | rest: {Description}" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("ignored", layers), "scene: ENV | action: POS | rest: CAM CHR", "层占位符各就各位，{Description} 只拿没放的层");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "老", value: "image###{Description}###" }]);
    eq(F("buildInjectTag")("CAM ENV CHR POS", layers), "image###CAM ENV CHR POS###", "老模板：整段进 {Description}");
    eq(F("buildInjectTag")("plain", null), "image###plain###", "非分层模式完全不受影响");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "全层", value: "{Camera}/{Env}/{Chars}/{Pose}" }]);
    eq(F("buildInjectTag")("whatever", layers), "CAM/ENV/CHR/POS", "四层全单放、没有 {Description} 也不多拼");
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
    ok(d.querySelector("#ipe-panel .ipe-footer").textContent.indexOf("v2.12.1") >= 0, "面板底栏带版本号");
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
    ok(JSON.stringify(all).indexOf("sk-SECRET") < 0 && JSON.stringify(all).indexOf("http://x") < 0, "不含 API 地址与密钥");
    const cur = F("ipeImgPackBuild")("current");
    eq(cur.templates.length, 1, "当前：只有一套模板"); eq(cur.templates[0].name, "暗色油画", "是选中的那套");
    eq(cur.rules.length, 1, "当前：只有一条规则"); eq(cur.rules[0].name, "GPT-image-2", "是选中的那条");
    eq(cur.systemPrompts.length, 1, "当前：系统提示只带选中的一槽");
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
    ok(F("ipeGetAnchorPresets")().find(x => x.name === "苑无忧"), "锚点追加");
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

console.log("\n【32】 挂账失败弹窗常驻：timeOut 0 必须手点；生图失败弹窗仍 9 秒自动消失");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    const got = [];
    w.toastr.error = (body, title, opts) => got.push({ body, title, opts });
    w.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await F("ipeLedgerRun")(9, true);
    eq(got.length, 1, "挂账失败弹了一条");
    eq(got[0].opts.timeOut, 0, "挂账弹窗不自动消失");
    eq(got[0].opts.extendedTimeOut, 0, "悬停离开也不消失");
    ok(got[0].opts.closeButton === true, "有关闭按钮");
    ok(got[0].title.indexOf("挂账失败") >= 0 && got[0].title.indexOf("上一份") >= 0, "标题直说账本还是上一份", got[0].title);
    ok(got[0].body.indexOf("重新挂账") >= 0, "正文告诉人怎么补");
    // 生图那边不变
    got.length = 0;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiEndpoint = "http://x.test/v1"; st.model = "gpt-4.1";
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(got.length, 1, "生图失败也弹了一条");
    eq(got[0].opts.timeOut, 9000, "生图失败弹窗保持 9 秒自动消失（它有自动重试）");
})();

console.log("\n" + "\u2500".repeat(46));
console.log(fail === 0 ? `\u5168\u90E8\u901A\u8FC7 \u2705  ${pass} \u9879` : `${pass} \u901A\u8FC7 / ${fail} \u5931\u8D25 \u274C`);
process.exit(fail === 0 ? 0 : 1);
})();
