# 连线题 / 匹配题适配

## 适配范围

`packages/scripts/src/utils/cx-question.ts` 提供作业、考试及章节测试共用的识别、题干/选项提取、填写和已答检测：

- 隐藏题型值 `11`，以及无题型隐藏字段时的“连线题/匹配题/配对题”文字或专有 DOM 识别。
- 旧版：`.line_wid_half.fl` / `.line_wid_half.fr` 两列，`.line_answer_ct .selectBox` 菜单与 `li[data]`。
- 新版：`.firstUlList` / `.secondUlList` 两列，`.thirdUlList select` / `select.dept_select` 原生下拉框（含 Chosen 包装）。
- 两列内容保留在题干中；每个匹配组包含其左侧题干、真实 `value/data` 与右侧标签/描述。图片沿用题目统一编号，支持题干、左右列内的图片。
- AI 按页面顺序返回 `b#a` 等实际选项值。填写前验证全部组数和值，拒绝占位项/禁用项/缺项，避免只填一部分却报告成功。
- 新版通过原生 `input` / `change` 通知保存，并触发 `chosen:updated`、同步显示文字；旧版沿用网页本身的菜单点击事件。最终重新读取实际作答值，未保存不标记完成。
- 已全部填写且每项有效时，开始/补全跳过；部分填写不会误判为已完成。答案检验与缓存通过同一题干和选项结构工作。

## 验证与边界

- `pnpm test` 中 `tests/matching.test.cjs` 覆盖新旧结构、字段缺失识别、题干/图片标记、实际选项值、保存事件/显示、已答保护、禁用/无效/缺项、保存失败和取消。
- 两个样例还在 Chrome 原生 DOM 中验证：新旧版都识别为 `line`、读到 2 组、写入并回读 `b#a`；新版实际触发 2 次原生 `change` 事件。
- DOM 样例：`tests/fixtures/matching-new.html`、`matching-legacy.html`，不含真实账号或课程信息。
- 本次未登录真实学习通课程验证平台提交结果；若页面采用上述结构之外的 Canvas 拖线控件，或异步选项尚未加载完整，应停止并提示人工检查，而不是猜测点击位置。
