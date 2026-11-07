# OCS 对照答题审计（2026-11-07）

本轮以本地 1.0.15 源码（含之前的考试图标、多选回填和“标记”按钮修复）为基线，对照 OCS 的学习通适配和选择题解析。确认并修复 9 类问题，新增 22 项回归，全量 418 项通过。结论适用于源码与本地 DOM/请求回放，不等于真实考试后台保存或评分验证。

## 对照来源与范围

固定参考 OCS `5.3.1` 标签，Release 显示短提交号 `06c2af6`；不将可变主分支当作本轮基线。访问日期：2026-11-07。

- [OCS 5.3.1 Release](https://github.com/ocsjs/ocsjs/releases/tag/5.3.1)
- [学习通适配 cx.ts](https://github.com/ocsjs/ocsjs/blob/5.3.1/packages/scripts/src/projects/cx.ts)：考试题型字段过滤、选择控件点击、章节判断题预处理。
- [多选解析 multiple.ts](https://github.com/ocsjs/ocsjs/blob/5.3.1/packages/core/src/core/worker/resolvers/multiple.ts)：归一化/相似匹配、符号消歧及候选排序。
- [判断题解析 judgement.ts](https://github.com/ocsjs/ocsjs/blob/5.3.1/packages/core/src/core/worker/resolvers/judgement.ts)：按真假语义匹配页面选项。
- [单选解析 single.ts](https://github.com/ocsjs/ocsjs/blob/5.3.1/packages/core/src/core/worker/resolvers/single.ts)：字母、精确文字和相似度候选处理。

外部项目仅用作静态对照，不执行其脚本，也不把“OCS 这样做”当作正确性的充分证明。每项修复均由本地失败用例与修复后通过结果支持。

本地重点链路：`cx.ts → describeCXQuestion/prepareCXQuestion → AI 标准化或旧匹配器 → fillStandardAnswer → readPageAnswer`。API 首次响应、格式重试、DeepSeek 网页响应均纳入验证。既有章节、填空、连线、编程、缓存与暂停取消测试随全量回归运行。

## 已确认并修复

| 编号 | 优先级与路径 | 修复前的具体触发/结果 | 修复与代码位置 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | P1，考试题型 | `type=0` 或 `typeFlag=0` 排在真实的 `type1=1` 前，读取首字段把多选当单选，多个答案只处理第一项。OCS 的考试回填逻辑专门过滤题目编号字段。 | `cx-question.ts:90`：优先选取 `type数字` / `answertype数字`，保留无编号字段的兼容。 | `cx-answer-flow.test.cjs` 的两种 `question-specific type` 场景。 |
| 2 | P1，AI 判断题标准化 | 选项顺序为“错误、正确”，模型回答 `1`，旧逻辑按选项序号映射成 A，选成错误；`0`、`T/F`、带前缀和繁体答案也有识别缺口。 | `ai.ts:939`：先清理答案前缀，再按真假语义寻找当前页面的选项；看不出真假含义的图片选项不凭 `1/0` 猜位置。 | 6 项真假语义用例及字母、未知答案边界。 |
| 3 | P1，旧文字匹配备用路径 | 答案 `-2`，选项 `2`、`-2`；相似度清洗丢失负号，单选选 `2`，多选把两个都选上。正常 AI 已标准化为字母时不受这一路径影响。 | `question.resolver.ts:31,125`：存在完整精确文字匹配时优先采用，随后才用相似匹配。 | `legacy single/multiple exact formula text` 两项先失败后通过。 |
| 4 | P2，AI 多选解析 | `answers:["TCP/IP","UDP"]` 或 `["C#","Rust"]` 被用 `/`、`#` 再次切开，合法答案变成格式错误或无法回填。 | `ai.ts:916`：保留结构化数组的边界；整项原文/明确分隔项先匹配。API 重试和网页响应均传递原始结构。 | 三种原文用例，以及 API、API 格式重试、DeepSeek 网页到勾选完整链路。 |
| 5 | P2，防止旧答案覆盖的校验 | 非题型辅助字段 `typeFlag` 更新会被旧正则当成题型变化，答案被拦截。 | `question-guard.ts:43`：和读取逻辑共用题型字段选择，只把实际题型字段及题目身份字段纳入标识。 | 等待回答时仅修改 `typeFlag`，仍成功写入；既有真实题型/题干/图片变化用例仍通过。 |
| 6 | P2，旧多选文字匹配 | 图片选项没有文字，任意文本都满足 `answer.includes('')`，空白图片项被误选。 | `question.resolver.ts:140`：仅对非空选项文字做包含匹配。 | 未知文本答案遇到空图片标签，返回未完成且不产生选择。 |
| 7 | P2，旧多选候选排序 | 相同匹配数量时，比较式为 `bsc+bss-asc+ass`，将较差候选留在前面。 | `question.resolver.ts:197`：改为 `bsc+bss-(asc+ass)`。 | 较差候选先返回、精确候选后返回，最终采用后者对应的选项。 |
| 8 | P2，上一轮过滤的边界 | 答案选项恰好叫“标记”且带 `onclick`，被误认作考试标记按钮，选项文字丢失。 | `question.ts:47`：处于答案区域/选项区域的元素不按工具栏标记按钮过滤。 | 实际点击选项名为“标记”的回填测试；此前三种真正标记按钮过滤用例仍通过。 |
| 9 | P2，多选改写的预检查 | 旧答案 A、B 已勾选，其中 B 禁用，目标答案 C；原逻辑先清掉 A，再发现 B 不可写并中断。 | `answer-writer.ts:43`：首个点击前同时验证目标选项和需要清除的旧选项。 | 禁用旧选项场景返回未完成，A/B 保持原样。 |

修复没有去掉题目变化保护，也没有把“已发出点击”直接当成写入成功。真实题干、选项、题型变化，用户等待期间手动改答案，禁用控件、取消、暂停、填空数量不匹配等既有测试继续通过。

## 验证证据

新增用例文件/位置：

- `tests/answer-normalization.test.cjs`：17 项，涵盖语义标准化、特殊字符、多候选匹配、API/网页回填和格式重试。
- `tests/cx-answer-flow.test.cjs`：新增 4 项，使用真实的本地 CourseWorker 与考试适配逻辑；仅模拟 AI/UI 等外部依赖。
- `tests/answer-writing.test.cjs`：新增 1 项，检查部分旧选项禁用时的零写入行为。

执行结果：

- `npm test`：418 passed，0 failed，0 skipped（本轮基线为 396）。
- `npm run typecheck`：通过。
- `npm run build`：通过，生成单文件安装脚本。
- `node --check dist/xuexitong-ai-helper.user.js`：通过。
- 对基线备份运行 `git diff --no-index --check`：无空白错误；当前工作目录是源码目录，没有 `.git`，未生成提交。

交付：`dist/xuexitong-ai-helper.user.js`。本轮修复随 1.0.16 发布，使用脚本管理器覆盖安装后刷新页面。这个安装包包含前两轮修复。

## 仍需真实页面验证的边界

1. 本轮没有连接用户登录的考试页，没有向真实 AI 发题，也没有提交试卷。DOM 的选中/输入值校验不能证明平台后台已经持久化，真实页面的自动保存失败仍需结合网络回执定位。
2. 章节判断题的旧预处理（`cx.ts` 的 `onElementSearched`）仍有直接改写选项 `textContent` 或追加对错符号的分支。本轮未把真实旧版章节页面的内嵌 input、大小写 True/False 和图标结构作为已验证范围；不因 OCS 存在相似代码就认定这些 DOM 变体安全。
3. 已有多选答案只说明页面有勾选，程序无法单凭页面状态推断是否漏选。自动跳过已答题仍保留用户当前作答；这一行为不等于确认答案正确或完整。
4. 本轮修复的是明确复现的匹配错误，没有证明所有模糊语义匹配都可靠。AI 字母标准化路径与旧题库文字相似匹配路径应继续区分，不能将本轮通过理解成评分正确率保证。
