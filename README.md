# 国家电网 Egern 小组件

在 Egern 小组件中显示“网上国网”的电费余额、欠费状态、本月用电、本月电费和最近用电数据。支持主屏幕小、中、大尺寸，以及锁屏圆形、矩形和单行小组件。

## 一键在线导入

[![一键导入 Egern](https://img.shields.io/badge/Egern-一键导入-00A88F?style=for-the-badge&logo=apple)](https://egernapp.com/modules/new?name=%E5%9B%BD%E5%AE%B6%E7%94%B5%E7%BD%91%E5%B0%8F%E7%BB%84%E4%BB%B6&url=https%3A%2F%2Fraw.githubusercontent.com%2FWyatt323%2FGJDW-Egern%2Frefs%2Fheads%2Fmain%2Fstate-grid.yaml)

请在安装了 Egern 的 iPhone 或 iPad 上点击按钮。也可以复制下面的模块地址，在 Egern 的“工具 → 模块 → +”中手动添加：

```text
https://raw.githubusercontent.com/Wyatt323/GJDW-Egern/refs/heads/main/state-grid.yaml
```

Egern 会默认每天检查模块更新；模块内的两个脚本也设置为每 24 小时检查一次更新。

## 首次使用

1. 导入后开启“国家电网小组件”模块。
2. 按照 Egern 提示安装并信任 MitM 证书，允许解析 `www.95598.cn`。
3. 保持 Egern 隧道开启，打开“网上国网”，进入电费余额、用电量和月度账单页面。
4. 回到 Egern，进入“分析 → 小组件画廊”，预览“国家电网”。
5. 在 iOS 主屏幕添加 Egern 小组件，长按小组件并选择“国家电网”。

## 多户与手动兜底

在模块的 Env 设置中可以配置：

- `ACCOUNT_INDEX`：多户序号，从 `0` 开始。
- `DISPLAY_NAME`：自定义显示名称，例如“家里”。
- `ACCOUNT`、`BALANCE`、`MONTH_KWH`、`MONTH_FEE`：接口未自动识别时手动填写。
- `OVERDUE`：手动指定是否欠费。
- `DATA_URL`：可选的兼容数据接口，不建议使用包含明文账号或密码的第三方地址。

## 数据与隐私

模块不会要求或保存网上国网的账号密码。响应采集脚本仅在 Egern 本地提取小组件所需字段，并写入 Egern 本地存储，不会把电费或户号数据上传到第三方服务器。小组件中的户号默认会脱敏显示。

由于网上国网各省接口存在差异，首次安装后需要在 App 中实际打开对应数据页面。如果接口结构发生变化，可以暂时使用 Env 手动数据兜底。

## 项目文件

- `state-grid.yaml`：Egern 在线模块入口。
- `state-grid-widget.js`：响应式 Widget DSL 界面。
- `state-grid-capture.js`：网上国网响应数据本地采集器。

## 参考

- [Egern 小组件文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)
- [Egern 模块文档](https://egernapp.com/zh-CN/docs/configuration/modules/)
- [Egern URL Scheme 文档](https://egernapp.com/zh-CN/docs/url-scheme/)
