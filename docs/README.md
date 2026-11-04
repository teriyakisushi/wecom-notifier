# 文档索引

## 使用者

| 文档 | 内容 |
| --- | --- |
| [README](../README.md) / [README.en](../README.en.md) | 项目简介、快速开始、示例 |
| [配置](configuration.md) | 输入总表、消息来源优先级、一事件一文件、vars/overrides |
| [模板](templates.md) | `{{ }}`、过滤器、`$if` / `$each`、上下文、限制 |
| [内置预设](events.md) | 每个 GitHub 事件生成什么卡片、`preset: card` 扁平输入 |
| [企业微信格式](wecom.md) | 8 种消息、模板卡片字段、限制、错误码 |
| [故障排查](troubleshooting.md) | 没消息、模板找不到、校验失败、企业微信错误码 |
| [构建器](index.html) | 浏览器内可视化编辑、预览、导出 JSON/YAML 和 Action 步骤 |

## 贡献者

| 文档 | 内容 |
| --- | --- |
| [开发](development.md) | 环境、命令、模块结构、测试、构建 dist、发布 |
| [贡献指南](../CONTRIBUTING.md) | PR 流程、代码约定、dist 提交规则 |
| [安全策略](../SECURITY.md) | 漏洞报告、威胁模型、webhook 泄露处理 |
| [变更记录](../CHANGELOG.md) | 版本历史 |

## 推荐阅读顺序

1. 第一次使用：README → 配置 → 内置预设。
2. 想改文案/卡片：内置预设 → 模板 → 配置（overrides）。
3. 想自定义复杂结构：模板 → 企业微信格式 → 用构建器导出。
4. 出问题：故障排查 → 对应章节。
5. 想贡献：开发 → 贡献指南。

## 构建器

打开 `docs/index.html` 即可使用，不需要安装依赖。它生成的是**消息体**（`.github/wecom-notify/<event>.yml`）；模板变量在导出时原样保留，不会替换成示例值。

GitHub Pages 从 `docs/` 发布后，地址形如：

```text
https://teriyakiushi.github.io/wecom-notifier/
```
