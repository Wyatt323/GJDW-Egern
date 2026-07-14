# 国家电网 Egern 小组件

在 Egern 小组件中使用网上国网账号密码登录，显示**当前余额、本月用电量、上月账单**，支持多户号以及主屏幕、锁屏组件。

## 一键在线导入

[![一键导入 Egern](https://img.shields.io/badge/Egern-一键导入-00A88F?style=for-the-badge&logo=apple)](https://egernapp.com/modules/new?name=%E5%9B%BD%E5%AE%B6%E7%94%B5%E7%BD%91%E5%B0%8F%E7%BB%84%E4%BB%B6&url=https%3A%2F%2Fraw.githubusercontent.com%2FWyatt323%2FGJDW-Egern%2Frefs%2Fheads%2Fmain%2Fstate-grid.yaml%3Fv%3D1.6.0)

也可以在 Egern“工具 → 模块 → +”中添加：

```text
https://raw.githubusercontent.com/Wyatt323/GJDW-Egern/refs/heads/main/state-grid.yaml?v=1.6.0
```

## v1.6.0 的重要变化

国网与南网的实现不同。当前公开维护的国网查询脚本使用 `www.95598.cn` 网页接口，并以 `api.wsgw-rewrite.com` 作为代理软件中的虚拟触发地址；它不是通过监听官方 App 的业务请求取数。

新版已删除旧版 `*.95598.cn` App 响应抓取、MitM 和 HTTP Capture 配置，改为主动登录查询。v1.6.0 会按自然月准确选择上月账单，并兼容国网查询引擎的跨年及扁平返回结构，不再把“最新月度记录”或旧版 `monthFee` 错标为上月账单。界面采用深海蓝绿渐变、半透明信息卡和更克制的 iOS 风格排版，在 Egern Widget DSL 不支持原生背景模糊的限制下，以透明叠层模拟轻量毛玻璃质感；小尺寸和中尺寸组件均重新整理了信息层级。耗时查询与主组件渲染保持分离，并保留短周期超时保护及迟到响应隔离。

## 完整设置

1. 在 Egern 中删除旧的“国家电网小组件”模块。
2. 使用上方带 `v=1.6.0` 的链接重新导入并启用模块。
3. 打开“工具 → 模块 → 国家电网小组件 → 环境变量”。
4. 填写 `SGCC_USERNAME`：网上国网登录账号，通常是手机号。
5. 填写 `SGCC_PASSWORD`：网上国网登录密码。
6. `ACCOUNT_INDEX` 默认为 `0`；第二个户号填 `1`，依次类推。
7. 启动 Egern，在“分析 → 小组件画廊”点击“国家电网·更新数据”，等待它返回数据或明确错误；首次查询可能需要 10～90 秒。
8. 更新成功后预览“国家电网”，它会立即读取缓存，不再等待登录请求。
9. 在 iOS 主屏幕添加 Egern 小组件，长按后选择“国家电网”。模块还会每天 08:15 和 18:15 自动更新。

账号设置完成后，不需要开启全局 MitM、HTTP 全局抓包，也不需要进入官方 App 刷新账单。

## 常见提示

- “请配置国网账号”：模块环境变量没有填写账号或密码。
- “账号或密码未配置/不正确”：检查是否能在 `https://www.95598.cn` 使用同一账号密码登录。
- “国网限制登录频率”：国网对每日登录次数有限制，请保留缓存并在次日重试，不要连续刷新。
- “国网登录验证未通过”：验证码或风控未通过，稍后再试。
- “查询引擎下载失败”：检查 Egern 是否能访问 `raw.githubusercontent.com`。
- 主组件显示“请先更新数据”：在小组件画廊运行一次“国家电网·更新数据”。
- 查询超时：打开“国家电网·诊断”，查看最后完成或停留在哪一步。
- 组件完全空白：先预览“国家电网·诊断”，确认应显示 `v1.6.0`。

### 如何阅读诊断卡片

v1.6.0 的诊断记录只显示请求序号、经过的服务、HTTP 状态、响应类型和响应长度，不显示请求路径、请求正文、响应正文、账号、密码或 Token。

| 诊断记录 | 含义 |
|---|---|
| `#1 api.120399.xyz → HTTP 200` | 第三方适配服务已接收国网请求的加密/预处理任务 |
| `#2 www.95598.cn → HTTP 200` | 国家电网页面接口已返回 HTTP 响应 |
| `#3 api.120399.xyz → HTTP 200` | 第三方适配服务已返回解密/转换结果 |
| `JSON · 1234B` | 响应看起来是 JSON，长度约为 1234 个字符 |
| `HTML`、`空响应`或`其他响应` | HTTP 虽然成功，但内容可能不是查询引擎预期的业务数据 |
| `查询超时：停在 …` | 最后一个步骤在 85 秒内没有完成整个查询流程 |

**HTTP 200 只代表服务器返回了响应，不代表登录或账单查询已经成功。** 如果连续三步均为 HTTP 200 但最终仍超时，请完整截图“国家电网·诊断”卡片；不要发送账号、密码或 Egern 环境变量页面。

成功登录后会缓存登录态，后续刷新通常不会重复完整登录。请避免短时间内频繁删除模块、清除数据或反复改密码。

## 可选设置

- `DISPLAY_NAME`：把账户名称显示为“家里”等自定义文字。
- `ACCOUNT_INDEX`：多户号选择，从 `0` 开始。
- `SGCC_DEBUG`：故障排查时设为 `true`，平时保持 `false`。
- `DATA_URL`：兼容旧版国网小组件 JSON 接口。
- `ACCOUNT`、`BALANCE`、`MONTH_KWH`、`LAST_MONTH_BILL`：手动数据兜底。旧版 `MONTH_FEE` 不会再被当作上月账单，以避免错标月份。

## 数据与风险说明

账号、密码的配置值以及登录态、查询结果保存在 Egern 本地，不会写入本 GitHub 仓库；发起登录时账号密码仍会按下述流程经网络提交。小组件中的户号默认脱敏。

主动查询适配层使用固定提交版本的 [Yuheng0101/X 网上国网脚本](https://github.com/Yuheng0101/X/tree/main/Tasks/95598)。该脚本访问国家电网 `www.95598.cn`，并把包含登录账号、密码的待加密请求提交给第三方服务 `api.120399.xyz` 进行加解密/验证处理。也就是说，**这不是“凭据只发给国家电网”的纯官方直连方案**。使用前请自行评估账号与隐私风险；如果不接受第三方处理密码，请不要填写账号密码，可使用手动数据或自建 `DATA_URL`。

本项目为非官方个人工具，仅供学习和个人查询使用。接口、验证码或风控策略变化都可能导致查询失效。

## 项目文件

- `state-grid.yaml`：Egern 在线模块入口。
- `state-grid-widget.js`：主动查询适配层与 Widget DSL 界面。
- `state-grid-health.js`：不依赖账号的诊断组件。
- `tests/widget.test.mjs`：上月账单选择与数据归一化测试。
- `state-grid-capture.js`：旧版响应采集入口的安全停用占位脚本，当前版本不加载、不会保存请求或响应。

## 参考

- [Egern JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [Egern 小组件文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)
- [Egern 模块文档](https://egernapp.com/zh-CN/docs/configuration/modules/)
- [网上国网重构脚本说明](https://github.com/Yuheng0101/X/blob/main/Tasks/95598/README.md)
