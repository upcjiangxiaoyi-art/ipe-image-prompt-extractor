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
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>新账本正文，够长够长够长够长够长够长够长。</ledger>" } }] }) });

    const exposed = ["ipeLedgerRead", "ipeLedgerSave", "ipeLedgerCommit", "ipeLedgerReconcile",
        "ipeFloorNo", "ipeLedgerApplyEP", "ipeLedgerNormalize", "ipeLedgerStop",
        "ipeLedgerIsAbort", "ipeLedgerExport", "ipeLedgerImportText", "ipeLedgerInspectEP",
        "EXT_NAME", "DEFAULTS", "IPE_LEDGER_EP_KEY", "init", "ipeLedgerStripImageTag", "ipeLedgerBuildUser", "ipeLedgerReportBlock", "ipeLedgerPruneMirror"];
    const shim = SRC + "\n;(function(){ " +
        exposed.map(n => `try{ window.__t_${n} = ${n}; }catch(e){}`).join(" ") + " })();";
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

console.log("\n" + "\u2500".repeat(46));
console.log(fail === 0 ? `\u5168\u90E8\u901A\u8FC7 \u2705  ${pass} \u9879` : `${pass} \u901A\u8FC7 / ${fail} \u5931\u8D25 \u274C`);
process.exit(fail === 0 ? 0 : 1);
