# Contributing

感谢你愿意改进 Xuexitong AI Helper。提交 issue 或 PR 前，请先阅读下面的约定。

## 开发环境

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm typecheck
pnpm build
```

构建产物会输出到 `dist/`，不要把 `dist/`、`node_modules/`、`packages/*/lib/` 提交到仓库。

## 提交 Issue

提交 bug 时请尽量包含：

- 脚本版本。
- 脚本管理器：Tampermonkey、Violentmonkey 或脚本猫。
- 出问题的页面：网课、作业/考试、手动搜题或设置页。
- 控制台错误、截图、AI 原始输出。
- AI 接口类型和模型名。

不要提交 API Key、Cookie、账号、课程个人信息或未打码的题目敏感内容。

## 提交 Pull Request

- 保持改动聚焦，避免一次 PR 混入无关重构。
- UI 改动请尽量附截图。
- AI 接口适配改动请说明请求格式、响应格式和错误兼容策略。
- 提交前至少运行 `pnpm typecheck` 和 `pnpm build`。

## 代码结构

- `packages/core`：工作器、题目处理、通用工具。
- `packages/scripts`：学习通适配、页面 UI、AI 配置和答题逻辑。
- `packages/utils`：用户脚本生成工具。
- `vendor/easy-us`：补丁版 UI 依赖。
- `scripts`：开发和构建脚本。

## 发布流程

Release 附件使用 `dist/xuexitong-ai-helper.common.user.js`。常规流程：

1. 更新版本号和 `CHANGELOG.md`。
2. 运行 `pnpm typecheck && pnpm build`。
3. 创建 tag 和 GitHub Release。
4. 上传 `dist/xuexitong-ai-helper.common.user.js`。
