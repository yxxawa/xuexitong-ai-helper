<div align="center">
  <img src="docs/assets/icon.svg" width="88" alt="Xuexitong AI Helper Icon">

  <h1>学习通 AI 辅助插件</h1>

  <p>
    <strong>面向学习通 / 超星的 AI助手、题目解析与油猴脚本 userscript</strong><br>
    支持 OpenAI 与 Anthropic 兼容接口，可用于 AI 设置、手动搜题、题目解析、作业/考试辅助和章节学习。
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

- AI 设置：支持 DeepSeek、OpenAI、Anthropic 和 OpenAI 兼容接口，支持模型列表获取、温度、最大输出和 JSON 输出限制。
- 作业考试：支持单选、多选、判断、填空等题型，题目图片会以 base64 方式传给支持视觉的模型。
- 手动搜题：输入题目或划词后调用 AI 搜索，并展示答案与原始输出。
- 结果查看：作业/考试页面可查看每题题目、AI 答案、原始输出、请求/响应和 token 用量。
- 学习设置：保留学习通章节学习相关设置。
- 相比于题库deepseek-v4-flash的价格似乎更加优惠。

## 安装使用

1. 安装 Tampermonkey、Violentmonkey 或脚本猫。
2. 从 [Releases](https://github.com/yxxawa/xuexitong-ai-helper/releases) 下载 `xuexitong-ai-helper.common.user.js`，导入脚本管理器。
3. 打开学习通页面，在悬浮窗口的“AI设置”中填写接口地址、API Key 和模型。
4. 进入作业、考试或章节测试页面后使用自动答题；也可以在“手动搜题”中单独调用 AI。

## 开发构建

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm build
```

常用命令：

```bash
pnpm typecheck
pnpm dev
```

构建产物默认输出到 `dist/`：

- `xuexitong-ai-helper.user.js`
- `xuexitong-ai-helper.dev.user.js`
- `xuexitong-ai-helper.common.user.js`

## 项目文档

- [贡献指南](CONTRIBUTING.md)：开发、提交 issue/PR 和发布流程。
- [安全说明](SECURITY.md)：API Key、Cookie、课程信息等敏感内容处理方式。
- [更新日志](CHANGELOG.md)：版本变化记录。
- [许可和来源说明](NOTICE.md)：OCS 和 easy-us 的来源与许可说明。

## 仓库结构

- `packages/core`：工作器、题目处理、通用工具。
- `packages/scripts`：学习通适配、页面 UI、AI 配置和答题逻辑。
- `packages/utils`：用户脚本生成工具。
- `vendor/easy-us`：随仓库保留的补丁版 UI 依赖，用于保持当前悬浮窗口行为。
- `scripts`：本地开发和构建脚本。

## Vendored 依赖

`vendor/easy-us` 来自 easy-us 项目，按 MIT License 随仓库保留。本项目依赖其中经过调整的悬浮窗口行为，因此没有直接使用 npm 安装的原版包。相关来源和许可见 [NOTICE.md](NOTICE.md)。

## 注意

本项目仅用于学习、研究和技术交流。使用时请遵守学校、课程和平台规则，不建议用于违反课程要求或平台规则的场景。

AI 输出可能存在错误，提交前应自行核对结果。反馈问题时请勿公开 API Key、Cookie、账号、课程个人信息或未打码的敏感截图。

## 致谢

本项目基于 OCS 和 easy-us 修改整理，遵循 MIT License。详细说明见 `NOTICE.md` 和 `LICENSE`。

## Star 趋势 ⭐

<p align="center">
  <a href="https://www.star-history.com/#yxxawa/xuexitong-ai-helper&Date">
    <img src="https://api.star-history.com/svg?repos=yxxawa/xuexitong-ai-helper&type=Date" width="520" alt="Star History Chart">
  </a>
</p>
