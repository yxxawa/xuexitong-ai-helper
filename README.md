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

- AI 设置：支持 DeepSeek、OpenAI、Anthropic 和 OpenAI 兼容接口，模型可直接输入，也可获取列表后筛选；支持温度和 JSON 模式；已移除“AI最大输出”，插件默认不设置输出 token 上限，旧配置不再生效；答案格式由内置提示词统一控制，不再支持自定义“AI输出限制”。
- 作业考试：支持单选、多选、判断、填空等题型，题目图片会以 base64 方式传给支持视觉的模型。
- 已答题保护：“开始答题”和“补全未完成”按网页实际作答状态跳过已答题，全部答完时给出提示；只有“重新答题”会重做已答题。
- 答案检验：作业/考试的已完成题目下方可点“检验”，携带当前答案、题干、选项及图片重新请求 AI（不复用旧答案缓存）。答案相同则保持；答案不同则显示新答案和 √ / ×，确认后同步网页、答题结果与缓存，放弃则不修改。检验仅是 AI 二次判断，不保证正确，请自行核对。
- 手动搜题：输入题目或划词后调用 AI 搜索，并展示答案与原始输出。
- 结果查看：作业/考试页面可查看每题题目、AI 答案、原始输出、请求/响应和 token 用量。
- 学习设置：保留学习通章节学习相关设置。
- 答案缓存：保存在本机，最多 200 题、有效期 7 天。题型、选项顺序、图片或 AI 配置变化时不会复用；可在设置中查看和清空。

## 安装使用

1. 安装 Tampermonkey、Violentmonkey 或脚本猫。
2. 从 [Releases](https://github.com/yxxawa/xuexitong-ai-helper/releases) 下载 `xuexitong-ai-helper.common.user.js`，导入脚本管理器。
3. 打开学习通页面，在悬浮窗口的“AI 设置”中填写接口地址、API Key 和模型。
4. 进入作业、考试或章节测试页面后使用自动答题；也可以在“手动搜题”中单独调用 AI。

输出长度仍受模型和服务商自身约束。OpenAI 兼容请求默认省略输出上限；Anthropic 原生协议必须提供 `max_tokens`，因此自动使用模型接口返回的 `max_output_tokens`，不再设定插件固定上限。若兼容接口既强制要求此参数又不提供模型上限，会明确报错，不会悄悄恢复旧限制。

## DeepSeek 网页桥接（实验）

设置 → **AI 来源 → DeepSeek 网页（实验）** → **打开 DeepSeek 专用标签页**。在同一浏览器的专用空白页登录后，点击 **启用此标签页**，保持该页打开，再回学习通开始。无需 API Key；API 模型输入等不适用于此模式，模型在网页启用前选择。

- 支持题干和选项图片：先上传全部图片，确认网页允许发送后再提交；有图片无法读取、上传失败或超时则不发送残缺题目。一个接收标签页串行处理，**同一会话使用 50 次后再新建会话**，命中本地缓存不计次数。
- 网页模式下自动答题与手动搜题互斥（包括不同学习通标签页、键盘搜索和章节测试）；自动答题整个任务期间占用连接，暂停不释放，结束/失败后释放。API 模式不受此互斥限制。
- 请求会进入当前网页账号的对话历史，并受网页自身额度/限制影响。不要在专用标签页手动聊天。
- 不读取 Cookie/访问令牌，不调用逆向私有接口，不处理登录、验证码或风控；断开、超时、解析失败会报错，不自动重发。
- 2026-09-20 已使用临时登录会话实测原生图片上传、一次发送及 JSON 答案读取。仍是 DOM 实验适配，网页改版、账号额度或风控可能使其失效；自动化回归使用本地模拟网页。更新脚本后请刷新旧专用标签页并重新启用。
- [实现、参考资料与扩展其他 AI 的方式](docs/deepseek-web.md)。

## 项目文档

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
