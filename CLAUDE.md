# 给 Claude 的协作约定

## 推送

- 这个仓库只有 Claude 在维护。仓库主人 ripple 完全授权：改完、测试全过就直接推 main，不用每次问。为了上下文干净会开新窗口，新窗口也照这条来。

## 每次改动 = 一个版本

- 版本号同时改：`index.js` 的 `IPE_VERSION`、`package.json`、`package-lock.json`（两处）、`manifest.json` 的 `version`。
- `manifest.json` 的 `description` 最前面加「🐚 小海螺 · x.y.z 标题：一段话｜」，旧的往后排。
- `README.md`：顶部加「## x.y.z · 标题」一节（改了什么、为什么、怎么验证）；「## 版本」里改当前版本，列表最前面加一行。
- 提交信息用中文：第一行「标题 x.y.z：一句话」，下面列要点。
- 只改 README、署名这类不动插件行为的，不升版本。

## 测试

- `npm install` 之后七套全跑：`npm test`（挂账）、`npm run test:ui`、`test:performance`、`test:dedup`、`test:cast`、`test:smooth`、`test:stream`。全过再推。
- 修 bug 先写能复现的测试，确认它在旧代码上会挂。

## 背景

- ripple 主要在 iPhone 的 Safari 上用酒馆，看不到控制台；排查靠面板状态行和中转后台的数字。
- Safari 切到后台常会重新载入页面，只放在内存里的状态会丢；要跨楼记住的东西放进聊天数据（chat_metadata）。
