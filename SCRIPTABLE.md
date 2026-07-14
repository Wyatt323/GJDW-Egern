# 国家电网 · Scriptable

`Script` 分支用于 iPhone/iPad 上的 [Scriptable](https://scriptable.app/)；它与 Egern 模块相互独立。

## 功能

- 在 Scriptable App 内显示原生控制面板；
- 账号、密码和登录会话保存在 iOS Keychain；查询缓存和诊断保存在 Scriptable 本地目录；
- 控制面板支持配置账号、立即更新、查看安全诊断、预览组件、清除本地数据；
- 支持 iOS 小尺寸、中尺寸和大尺寸桌面组件；
- 点击组件可通过 Scriptable Deep Link 启动脚本：小尺寸整体点击更新，中/大尺寸右上角 `↻` 更新；
- 主组件显示余额、本月用电、上月账单及最近诊断；
- 查询数据失败时保留最后一次成功缓存。

## 安装

1. 在 iPhone/iPad 安装 Scriptable。
2. 下载本分支的 [`StateGrid.js`](./StateGrid.js)，或直接打开：

   ```text
   https://raw.githubusercontent.com/Wyatt323/GJDW-Egern/refs/heads/Script/StateGrid.js
   ```

3. 在 Scriptable 新建脚本，名称必须设为：

   ```text
   StateGrid
   ```

4. 把 `StateGrid.js` 全部内容复制进去并保存。
5. 在 Scriptable 中直接运行 `StateGrid`，进入控制面板。
6. 点击“账号与显示设置”，填写网上国网账号和密码。
7. 点击“立即更新”，等待查询完成。
8. 在 iOS 主屏幕添加 Scriptable 小组件，长按组件 → 编辑小组件 → Script 选择 `StateGrid`。

## 控制面板

| 操作 | 说明 |
|---|---|
| 立即更新 | 登录网上国网并刷新本地缓存 |
| 账号与显示设置 | 设置账号、密码、名称和多户号序号 |
| 查询诊断 | 查看最近 20 条脱敏后的请求步骤和状态 |
| 预览小组件 | 在 Scriptable 内预览中/小尺寸 |
| 清除本地数据 | 删除 Keychain 凭据，以及本地缓存、诊断和登录会话 |

## 手动更新

- 在控制面板点击“立即更新”；或
- 小尺寸组件点击整个组件；中/大尺寸组件点击右上角 `↻`。iOS 会打开 Scriptable 并执行一次更新。

Scriptable/iOS 不允许桌面组件在后台进行任意交互，因此点击更新会跳转到 Scriptable，这是系统限制。

## 数据与隐私

账号、密码和登录会话状态保存在当前设备的 iOS Keychain；查询缓存和诊断保存在 Scriptable 本地目录。以上数据都不会写入 GitHub。查询引擎每次更新时从固定 Git 提交地址重新下载，不在设备上长期缓存。

主动查询适配层使用固定提交版本的 [Yuheng0101/X 网上国网脚本](https://github.com/Yuheng0101/X/tree/main/Tasks/95598)。该第三方脚本会在 Scriptable 进程中执行，访问国家电网 `www.95598.cn`，并把包含登录凭据的待加密请求提交给第三方服务 `api.120399.xyz` 处理。因此这不是仅连接国家电网的纯官方方案；如果不接受第三方代码执行或第三方处理凭据，请勿使用账号密码查询。

## 开发验证

核心数据归一化、跨年上月选择、Deep Link、诊断脱敏和多户号选择可以在 Node.js 中测试：

```bash
node tests/scriptable.test.mjs
```

> 服务器上的 Node 测试不能代替真机 Scriptable 运行验证。`UITable`、`Keychain`、`ListWidget`、Deep Link 和实际登录需要在 iPhone/iPad 上最终确认。
