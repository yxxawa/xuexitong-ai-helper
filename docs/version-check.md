# 版本显示与更新检查

首页右下角显示脚本管理器返回的当前安装版本。没有检测到更高的正式版本时显示 `v1.0.11`；发现新版时显示 `v1.0.11 → v1.0.12`。整个版本号是超链接，始终打开本仓库的最新 Release：

```text
https://github.com/yxxawa/xuexitong-ai-helper/releases/latest
```

## 公共版本信息

仓库根目录的 `version.json` 是公开 JSON 端点，由 `npm run build` 根据 `package.json` 自动生成，不需要另起服务器，也不作为 Release 附件上传。发布前将版本文件和对应源码一起提交，再发布相同版本号的正式 Release。

```json
{
  "version": "1.0.11",
  "tag": "v1.0.11",
  "releaseUrl": "https://github.com/yxxawa/xuexitong-ai-helper/releases/latest"
}
```

脚本通过以下公共地址读取版本；只解析版本字段，不执行远端代码，不使用 GitHub 登录令牌，也不发送课程、题目或 AI 密钥：

```text
https://cdn.jsdelivr.net/gh/yxxawa/xuexitong-ai-helper@main/version.json
https://raw.githubusercontent.com/yxxawa/xuexitong-ai-helper/main/version.json
https://api.github.com/repos/yxxawa/xuexitong-ai-helper/releases/latest
```

多个通道同时检查，采用其中最高的有效正式版本，避免 CDN 缓存旧数据时漏掉 GitHub 已发布的新版本。过滤草稿、预发布和无效数据，保存的版本不会被较旧的响应降级。成功结果缓存 30 分钟，全部失败缓存 5 分钟；多个首页渲染合并同一次检查。每个请求最多等 5 秒，期间首页立即显示当前版本，失败时不弹提示。

CDN 增加了可用通道，但 GitHub、Raw 和海外 CDN 都不能保证在所有国内网络可达。如果需要固定的国内服务，可将同一份 `version.json` 同步到自有国内静态站或 Gitee；这需要相应账号及托管配置，当前不依赖这类外部账户。Release 安装附件仍只有 `xuexitong-ai-helper.user.js`。