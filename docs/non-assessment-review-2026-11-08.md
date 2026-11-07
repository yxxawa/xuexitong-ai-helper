# 课程学习与设置检查（2026-11-08）

本次检查聚焦课程学习、播放器选择、暂停/继续/停止/重试、章节跳转、独立阅读、设置备份，以及构建产物界面。没有进入、作答或提交真实作业、考试、章节测试、视频题目。

真实登录课程页仅做只读 DOM 检查，确认章节目录和导航入口可识别。媒体播放、翻页及配置修改使用独立本地页面；平台调用由本地替身记录，外部 HTTP 请求被阻断。现有全量单测中的答题用例也仅在本地模拟环境运行。

## 已复现并修复

| 触发方式 | 修复前行为 | 修复 |
| --- | --- | --- |
| 课程播放器前存在隐藏试听音频 | 先播放隐藏音频，实际课程视频没有启动 | 初始化与播放器替换均限定在实际课程播放器容器内查找媒体 |
| 课程视频启动、恢复或修改音量设置 | 先前改动会按保存的非零音量播放，与视频应保持静音的要求不符 | 视频统一设置静音和零音量；覆盖首次播放、手动/自动恢复、网络重试、更换播放器及设置变更；运行时恢复被播放器取消的静音，结束后清理监听。滑块标注为“音频音量（视频固定静音）” |
| 任务超时后更改设置，再点击重试 | 沿用第一次启动时的设置，重新超时 | 重试重新读取当前学习设置及接口配置 |
| 跳转倒计时中改成手动模式 | 报“未知跳转模式”；返回第一章的延迟动作仍可能执行 | 在实际导航前重新检查手动模式，覆盖下一节、未完成章节和返回第一章 |
| 关闭自动阅读或离开独立阅读页 | 旧定时器仍调用翻页 | 阅读入口尊重功能开关；离页取消等待和后续动作；运行中关闭开关后不再翻页 |
| 阅读按钮的层级来自 CSS，或阅读器加载不完整 | 只检查行内样式，可能找不到按钮；依赖缺失可能长期等待或抛未处理异常 | 使用计算样式和可见性选择按钮；依赖与模块初始化有超时；页码无效时明确停止 |

视频静音是用户要求的正常行为，不列为故障。音量滑块仅调节纯音频任务，并兼容已有字符串音量值。播放器恢复仍使用原有有界重试和完成确认。普通阅读保留末页跳转；计时阅读保留原有等待时长及正文、封底顺序，不用估算等待替代平台完成标记。

## 验证

- 全量本地测试：465 项通过，0 失败、0 跳过。
- 新增回归：20 项，覆盖上述失败路径、阅读取消、过期回调、加载超时、页码兼容、实际章节执行器及视频静音要求；既有恢复与替换用例也增加静音断言。
- Edge 156.0.4314.58：10 项本地原生媒体/控件/阅读检查通过。HTMLVideoElement 加载本地静音 WAV，夹具初始不设置静音，验证业务代码设置静音、原生音量事件、暂停续播和播放器替换。
- 最终安装产物：8 项界面检查通过，含首页版本显示、课程设置、设置导出下载、有效导入、无效导入不改值、重新打开设置回显。
- 三个包类型检查通过；视频静音调整后补跑脚本包类型检查。
- 构建、安装脚本语法及 diff 空白检查通过。

主要命令：

```powershell
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit -p packages/scripts/tsconfig.json
node node_modules/gulp-cli/bin/gulp.js -f scripts/build-core.js
node --check dist/xuexitong-ai-helper.user.js
node output/playwright/non-assessment-browser.cjs
node output/playwright/full-artifact-smoke.cjs
```

构建命令需要将项目 `node_modules/.bin` 加入当前进程 PATH。浏览器检查脚本与证据保存在已忽略的 `output/playwright/` 中；回归用例在 `tests/study-integration.test.cjs`、`tests/study.test.cjs` 和 `tests/study-reader.test.cjs` 中。

## 证据与边界

- `output/playwright/non-assessment-browser.json`、`non-assessment-browser.png`：本地原生视频元素的静音、控件、设置及计时阅读检查。
- `output/playwright/full-artifact-smoke.json`、`full-artifact-course-settings.png`：最终产物界面检查，JSON 包含制品 SHA-256。
- `output/playwright/course-catalog-observation.json`：真实课程目录只读检查摘要。
- `%TEMP%/xth-mute-all-tests.log`、`xth-mute-build.log`、`xth-mute-typecheck.log`：静音调整后的测试、构建和类型检查日志。

本轮没有安装脚本到用户真实账号，也没有执行实际课程任务的完成上报或跳转。真实平台长视频、跨域书籍页及其与主控制面板的联动、登录过期恢复、付费 AI 接口和不同学校定制页面尚未进行完整现场验证，不能据此认定所有功能均无缺陷。

上述修复纳入 1.0.18，安装产物为 `dist/xuexitong-ai-helper.user.js`。发布时将源码与版本元数据同步至 `yxxawa/xuexitong-ai-helper`，Release 说明按用户要求留空。