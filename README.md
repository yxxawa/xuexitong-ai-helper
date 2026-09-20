<div align="center">
  <img src="docs/assets/icon.svg" width="88" alt="Xuexitong AI Helper Icon">

  <h1>学习通 AI 辅助插件</h1>

  <p>
    <strong>面向学习通 / 超星的 AI助手、题目解析与油猴脚本 userscript</strong><br>
    支持 OpenAI 与 Anthropic 兼容接口，支持跨站使用deepseek，可用于 AI 设置、手动搜题、题目解析、作业/考试辅助和章节学习。
  </p>

  <p>
    <a href="https://github.com/yxxawa/xuexitong-ai-helper/releases">
      <img src="https://img.shields.io/github/v/release/yxxawa/xuexitong-ai-helper?label=release" alt="Release">
    </a>
    <a href="./LICENSE">
      <img src="https://img.shields.io/github/license/yxxawa/xuexitong-ai-helper" alt="License">
    </a>
    <a href="https://github.com/yxxawa/xuexitong-ai-helper/stargazers">
      <img src="https://img.shields.io/github/stars/yxxawa/xuexitong-ai-helper?style=flat" alt="Stars">
    </a>
  </p>
</div>    
<img width="2559" height="1401" alt="image" src="https://github.com/user-attachments/assets/af81c110-0dd1-4270-9908-be1cdff018e7" />

## 主要功能

- 学习功能仅在 `chaoxing.com` 及其子域运行；另外只为实验桥接匹配 `https://chat.deepseek.com/*`，该站不显示学习面板，普通聊天标签页不启用接收端。
- 外观自动跟随系统深浅主题；首页保留常用操作入口。

- AI 设置：支持 DeepSeek、OpenAI、Anthropic 和 OpenAI 兼容接口，模型可直接输入，也可获取列表后筛选；支持温度、最大输出和 JSON 模式；答案格式由内置提示词统一控制，不再支持自定义“AI输出限制”。
- 作业考试：支持单选、多选、判断、填空等题型，题目图片会以 base64 方式传给支持视觉的模型。
- 手动搜题：输入题目或划词后调用 AI 搜索，并展示答案与原始输出。
- 结果查看：作业/考试页面可查看每题题目、AI 答案、原始输出、请求/响应和 token 用量。
- 学习设置：保留学习通章节学习相关设置。
- 答案缓存：保存在本机，最多 200 题、有效期 7 天。题型、选项顺序、图片或 AI 配置变化时不会复用；可在设置中查看和清空。

## 安装使用

1. 安装 Tampermonkey、Violentmonkey 或脚本猫。
2. 从 [Releases](https://github.com/yxxawa/xuexitong-ai-helper/releases) 下载 `xuexitong-ai-helper.common.user.js`，导入脚本管理器。
3. 打开学习通页面，在悬浮窗口的“AI 设置”中填写接口地址、API Key 和模型。
4. 进入作业、考试或章节测试页面后使用自动答题；也可以在“手动搜题”中单独调用 AI。

## 图片能力与选项

检查整个题目区域，包括题干、任一选项及其旁边的图片；图片选项保留原始顺序。自动模式不再根据模型名称猜测能力：优先读取接口提供的输入能力信息。**仅文本或能力未知时整题跳过，不把残缺的文字题发送给模型。** 未知模型可先用设置里的随机测试图验证。授权、网络和限流错误不会把模型标记为不支持。

部分兼容接口会接受图片字段但忽略其内容，因此“接口接受图片”并不等于确认具备视觉识别能力。设置中的 **检测图片（少量计费）** 会发送本地生成的随机数字测试图，不含课程或题目内容；正确读出数字才标记为检测通过，也可手动覆盖。能力记录按接口、模型及凭据隔离，7 天后过期。

选择题按实际选项列表限制答案（支持 A–Z），空回答或错误格式共用一次重试额度（API 每题最多两次请求）；仍无法匹配时显示错误，不会把格式错误的 AI 答案当作有效答案；手动开启的随机作答设置不受此规则替代。多选题允许只有一个正确答案。

## DeepSeek 网页桥接（实验）

设置 → **AI 来源 → DeepSeek 网页（实验）** → **打开 DeepSeek 专用标签页**。在同一浏览器的专用空白页登录后，点击 **启用此标签页**，保持该页打开，再回学习通开始。无需 API Key；API 模型输入等不适用于此模式，模型在网页启用前选择。

- 支持题干和选项图片：先上传全部图片，确认网页允许发送后再提交；有图片无法读取、上传失败或超时则不发送残缺题目。一个接收标签页串行处理，**同一会话使用 50 次后再新建会话**，命中本地缓存不计次数。
- 网页模式下自动答题与手动搜题互斥（包括不同学习通标签页、键盘搜索和章节测试）；自动答题整个任务期间占用连接，暂停不释放，结束/失败后释放。API 模式不受此互斥限制。
- 请求会进入当前网页账号的对话历史，并受网页自身额度/限制影响。不要在专用标签页手动聊天。
- 不读取 Cookie/访问令牌，不调用逆向私有接口，不处理登录、验证码或风控；断开、超时、解析失败会报错，不自动重发。
- 2026-09-20 已使用临时登录会话实测原生图片上传、一次发送及 JSON 答案读取。仍是 DOM 实验适配，网页改版、账号额度或风控可能使其失效；自动化回归使用本地模拟网页。更新脚本后请刷新旧专用标签页并重新启用。
- [实现、参考资料与扩展其他 AI 的方式](docs/deepseek-web.md)。

## 项目文档

- [贡献指南](.github/CONTRIBUTING.md)：开发、提交 issue/PR 和发布流程。
- [安全说明](.github/SECURITY.md)：API Key、Cookie、课程信息等敏感内容处理方式。
- [更新日志](docs/CHANGELOG.md)：版本变化记录。
- [许可和来源说明](NOTICE.md)：OCS 和 easy-us 的来源与许可说明。

## 致谢

本项目基于 OCS 和 easy-us 修改整理，遵循 MIT License。详细说明见 `NOTICE.md` 和 `LICENSE`。

## Star 趋势 ⭐

<p align="center">
  <a href="https://www.star-history.com/#yxxawa/xuexitong-ai-helper&Date">
    <img src="https://api.star-history.com/svg?repos=yxxawa/xuexitong-ai-helper&type=Date" width="520" alt="Star History Chart">
  </a>
</p>
