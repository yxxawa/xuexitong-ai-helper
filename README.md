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
- 作业考试：支持单选、多选、判断、填空及新旧版连线/匹配题（含原生下拉框）等题型，题目图片会以 base64 方式传给支持视觉的模型。
- 已答题保护：“开始答题”和“补全未完成”按网页实际作答状态跳过已答题，全部答完时给出提示；只有“重新答题”会重做已答题。
- 答案检验：作业/考试的已完成题目下方可点“检验”，携带当前答案、题干、选项及图片重新请求 AI（不复用旧答案缓存）。答案相同则保持；答案不同则显示新答案和 √ / ×，确认后同步网页、答题结果与缓存，放弃则不修改。检验仅是 AI 二次判断，不保证正确，请自行核对。
- 手动搜题：输入题目或划词后调用 AI 搜索，并展示答案与原始输出。
- 暂停与停止：暂停后不再写入、翻页、保存/提交或重试限流消息，继续后处理原请求；停止会取消后续作答，并更新结果状态。
- 设置备份：设置页的“设置备份与恢复”支持导出和导入用户配置，保留关闭开关、0 和空值；备份包含 API Key，请妥善保管。
- 结果查看：作业/考试页面可查看每题题目、AI 答案、原始输出、请求/响应和 token 用量。
- 学习设置：保留学习通章节学习相关设置。视频内题目可选择“轮换选项直到通过”，每 3 秒通过原生控件更换选项或多选组合提交，直到题目关闭；也可选择等待手动处理，不隐藏题目或验证提示。
- 答案缓存：保存在本机，最多 200 题、有效期 7 天。题型、选项顺序、图片或 AI 配置变化时不会复用；可在设置中查看和清空。


## 安装使用

1. 安装 Tampermonkey、Violentmonkey 或脚本猫。
2. 从 [Releases](https://github.com/yxxawa/xuexitong-ai-helper/releases) 下载 `xuexitong-ai-helper.common.user.js`，导入脚本管理器。
3. 打开学习通页面，在悬浮窗口的“AI 设置”中填写接口地址、API Key 和模型。
4. 进入作业、考试或章节测试页面后使用自动答题；也可以在“手动搜题”中单独调用 AI。

## 项目文档

- [许可和来源说明](NOTICE.md)：OCS 和 easy-us 的来源与许可说明。

## Star 趋势 ⭐

<p align="center">
  <a href="https://www.star-history.com/#yxxawa/xuexitong-ai-helper&Date">
    <img src="https://api.star-history.com/svg?repos=yxxawa/xuexitong-ai-helper&type=Date" width="520" alt="Star History Chart">
  </a>
</p>
