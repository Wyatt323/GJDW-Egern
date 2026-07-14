// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: bolt;

const VERSION = "1.0.0";
const IS_NODE_TEST = typeof config === "undefined";
const KEYS = {
  settings: "stategrid.scriptable.settings.v1",
};
const FILES = { cache: "stategrid-cache-v1.json", diagnostic: "stategrid-diagnostic-v1.json", providerState: "stategrid-provider-state-v1.json" };
const PROVIDER_URL = "https://raw.githubusercontent.com/Yuheng0101/X/9ea8da5ce1d83572e937fa5d6882edb8382c4c30/Tasks/95598/95598.js";
const COLORS = { ink: "16213A", teal: "0B7285", mint: "25A18E", white: "FFFFFF", muted: "BCE6E4", danger: "FFD4D1", success: "BFFFE7" };

if (!IS_NODE_TEST) await main();

async function main() {
  const action = String(args.queryParameters?.action || "");
  if (config.runsInWidget) {
    Script.setWidget(await createWidget(loadCache(), loadSettings(), config.widgetFamily));
    Script.complete();
    return;
  }
  if (action === "refresh") {
    await refreshData(true);
    Script.complete();
    return;
  }
  if (action === "settings") await editSettings();
  else if (action === "refresh-now") await refreshData(true);
  else if (action === "preview-small") await (await createWidget(loadCache(), loadSettings(), "small")).presentSmall();
  else if (action === "preview-large") await (await createWidget(loadCache(), loadSettings(), "large")).presentLarge();
  else if (action === "clear") await clearLocalData();
  await showControlPanel();
  Script.complete();
}

function loadSettings() {
  if (!Keychain.contains(KEYS.settings)) return { accountIndex: 0, displayName: "", openURL: "https://www.95598.cn/osgweb/index" };
  try { return { accountIndex: 0, displayName: "", openURL: "https://www.95598.cn/osgweb/index", ...JSON.parse(Keychain.get(KEYS.settings)) }; }
  catch (_) { return { accountIndex: 0, displayName: "", openURL: "https://www.95598.cn/osgweb/index" }; }
}
function saveSettings(value) { Keychain.set(KEYS.settings, JSON.stringify(value)); }
function localFile(name) { const fm = FileManager.local(); const dir = fm.joinPath(fm.documentsDirectory(), "StateGridData"); if (!fm.fileExists(dir)) fm.createDirectory(dir, true); return { fm, path: fm.joinPath(dir, name) }; }
function readLocal(name, fallback) { try { const f = localFile(name); return f.fm.fileExists(f.path) ? f.fm.readString(f.path) : fallback; } catch (_) { return fallback; } }
function writeLocal(name, value) { const f = localFile(name); f.fm.writeString(f.path, value); }
function removeLocal(name) { const f = localFile(name); if (f.fm.fileExists(f.path)) f.fm.remove(f.path); }
function loadCache() { try { return JSON.parse(readLocal(FILES.cache, "")) || { accounts: [], updatedAt: "" }; } catch (_) { return { accounts: [], updatedAt: "" }; } }
function saveCache(value) { writeLocal(FILES.cache, JSON.stringify(value)); }
function saveDiagnostic(kind, message) { writeLocal(FILES.diagnostic, JSON.stringify({ kind, message, at: new Date().toISOString() })); }
function loadDiagnostic() { try { return JSON.parse(readLocal(FILES.diagnostic, "")) || { kind: "idle", message: "尚未查询", at: "" }; } catch (_) { return { kind: "idle", message: "尚未查询", at: "" }; } }

async function showControlPanel() {
  const table = new UITable();
  table.showSeparators = false;
  const settings = loadSettings();
  const cache = loadCache();
  const diagnostic = loadDiagnostic();
  const selected = selectAccount(cache.accounts || [], settings);
  addTitle(table, "国家电网", `Scriptable 控制台 · v${VERSION}`);
  addStatus(table, selected ? `${settings.displayName || selected.name || "账户"}  ·  余额 ${money(selected.balance)}` : "尚无账户数据", diagnostic);
  addAction(table, "立即更新", "登录并查询网上国网", "arrow.clockwise", async () => { await refreshData(true); });
  addAction(table, "账号与显示设置", "凭据保存在 iOS Keychain", "person.crop.circle", async () => { await editSettings(); });
  addAction(table, "预览小组件", "中尺寸", "rectangle", async () => { await (await createWidget(loadCache(), loadSettings(), "medium")).presentMedium(); });
  addAction(table, "预览小组件", "小尺寸", "square", async () => { await (await createWidget(loadCache(), loadSettings(), "small")).presentSmall(); });
  addAction(table, "清除本地数据", "删除凭据、缓存和诊断", "trash", async () => { await clearLocalData(); });
  await table.present();
}

function addTitle(table, title, subtitle) {
  const row = new UITableRow(); row.height = 70; row.isHeader = true;
  const cell = row.addText(title, subtitle); cell.titleFont = Font.boldSystemFont(25); cell.subtitleFont = Font.systemFont(12);
  table.addRow(row);
}
function addStatus(table, title, diagnostic) {
  const stamp = diagnostic.at ? formatTime(diagnostic.at) : "--:--";
  const row = new UITableRow(); row.height = 64;
  const cell = row.addText(title, `${stamp} · ${diagnostic.message}`); cell.titleFont = Font.semiboldSystemFont(16); cell.subtitleFont = Font.systemFont(12);
  table.addRow(row);
}
function addAction(table, title, subtitle, symbol, handler) {
  const row = new UITableRow(); row.height = 58; row.dismissOnSelect = false;
  const icon = row.addImage(SFSymbol.named(symbol).image); icon.widthWeight = 12;
  const textCell = row.addText(title, subtitle); textCell.widthWeight = 80; textCell.titleFont = Font.semiboldSystemFont(16); textCell.subtitleFont = Font.systemFont(11);
  row.onSelect = handler; table.addRow(row);
}

async function editSettings() {
  const old = loadSettings();
  const alert = new Alert(); alert.title = "国家电网设置"; alert.message = "账号密码只保存于 iOS Keychain；查询时会由第三方 api.120399.xyz 参与加解密处理。";
  alert.addTextField("网上国网账号", old.username || "");
  alert.addSecureTextField("网上国网密码", old.password || "");
  alert.addTextField("显示名称（可选）", old.displayName || "");
  alert.addTextField("户号序号（从 0 开始）", String(old.accountIndex || 0));
  alert.addAction("保存"); alert.addCancelAction("取消");
  if (await alert.presentAlert() < 0) return;
  const username = alert.textFieldValue(0).trim();
  const password = alert.textFieldValue(1);
  if (username !== old.username || password !== old.password) removeLocal(FILES.providerState);
  saveSettings({ ...old, username, password, displayName: alert.textFieldValue(2).trim(), accountIndex: Math.max(0, parseInt(alert.textFieldValue(3), 10) || 0) });
}

async function refreshData(notify) {
  const settings = loadSettings();
  if (!settings.username || !settings.password) { saveDiagnostic("error", "请先配置账号和密码"); if (notify) await showMessage("无法更新", "请先填写网上国网账号和密码。"); return; }
  saveDiagnostic("pending", "正在登录并查询");
  try {
    const payload = await queryStateGrid(settings);
    const accounts = normalizeAccounts(payload);
    if (!accounts.length) throw new Error("没有返回户号数据");
    saveCache({ accounts, updatedAt: new Date().toISOString() }); saveDiagnostic("success", `查询成功：${accounts.length} 个户号`);
    if (notify) await showMessage("更新完成", `已更新 ${accounts.length} 个户号。`);
  } catch (error) {
    const message = safeDiagnostic(error); saveDiagnostic("error", message);
    if (notify) await showMessage("更新失败", message);
  }
}

async function queryStateGrid(settings) {
  const source = await requestText(PROVIDER_URL);
  if (source.length < 50000) throw new Error("查询引擎下载失败");
  return runProvider(source, settings);
}
function runProvider(source, settings) {
  return new Promise((resolve, reject) => {
    let settled = false; let notice = ""; let timer = null;
    const cleanup = () => { globalThis.$request = undefined; globalThis.$argument = {}; globalThis.$persistentStore = undefined; globalThis.$notification = undefined; globalThis.$httpClient = undefined; globalThis.$done = undefined; };
    const finish = (fn, value) => { if (settled) return; settled = true; if (timer) timer.invalidate(); cleanup(); fn(value); };
    const prefValues = { "95598_username": settings.username, "95598_password": settings.password, "95598_account_index": String(settings.accountIndex || 0), "95598_showmode": "0" };
    let providerState = {};
    try { providerState = JSON.parse(readLocal(FILES.providerState, "{}")); } catch (_) {}
    if (!providerState || typeof providerState !== "object" || Array.isArray(providerState)) providerState = {};
    const saveProviderValue = (value, key) => {
      const stringValue = value == null ? "" : String(value);
      if ((settings.username && stringValue.includes(settings.username)) || (settings.password && stringValue.includes(settings.password)) || stringValue.length > 20000) return false;
      if (value == null) delete providerState[key]; else providerState[key] = stringValue;
      writeLocal(FILES.providerState, JSON.stringify(providerState)); return true;
    };
    const $prefs = { valueForKey: (key) => prefValues[key] || providerState[key] || null, setValueForKey: saveProviderValue, removeValueForKey: (key) => saveProviderValue(null, key) };
    const $persistentStore = { read: $prefs.valueForKey, write: saveProviderValue };
    const $notification = { post: (_, __, body) => { notice = String(body || ""); } };
    const $httpClient = providerHttpClient();
    globalThis.Egern = globalThis.Egern || {};
    globalThis.$request = { method: "GET", url: "https://api.wsgw-rewrite.com/electricity/bill/all" };
    globalThis.$argument = { username: settings.username, password: settings.password, service: "true", debug: "false", notify_all_accounts: "true" };
    globalThis.$persistentStore = $persistentStore;
    globalThis.$notification = $notification;
    globalThis.$httpClient = $httpClient;
    const $done = (value) => {
      try { finish(resolve, parseProviderResult(value)); }
      catch (error) { finish(reject, new Error(notice || error.message || "查询服务返回异常")); }
    };
    globalThis.$done = $done;
    timer = Timer.schedule(85000, false, () => finish(reject, new Error("查询服务超时")));
    try { Function("$prefs", "$persistentStore", "$notification", "$httpClient", "$done", "console", `${source}\n//# sourceURL=state-grid-provider.js`)($prefs, $persistentStore, $notification, $httpClient, $done, console); }
    catch (error) { finish(reject, error); }
  });
}
function parseProviderResult(value) {
  const response = value?.response || value;
  if (response && typeof response === "object" && typeof response.body === "string") return JSON.parse(response.body);
  if (Array.isArray(response) || (response && typeof response === "object")) return response;
  throw new Error("查询脚本没有返回数据");
}

function providerHttpClient() {
  const send = (method, options, callback) => {
    const input = typeof options === "string" ? { url: options } : options || {};
    const request = new Request(input.url); request.method = method; request.timeoutInterval = 25;
    if (input.headers) request.headers = input.headers;
    if (input.body != null) request.body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    request.loadString().then((body) => callback(null, { status: request.response.statusCode, statusCode: request.response.statusCode, headers: request.response.headers }, body)).catch((error) => callback(error));
  };
  return { get: (o, c) => send("GET", o, c), post: (o, c) => send("POST", o, c), put: (o, c) => send("PUT", o, c), delete: (o, c) => send("DELETE", o, c) };
}
async function requestText(url) { const req = new Request(url); req.timeoutInterval = 20; return req.loadString(); }

async function createWidget(cache, settings, family) {
  const widget = new ListWidget(); const gradient = new LinearGradient(); gradient.colors = [new Color(COLORS.ink), new Color(COLORS.teal), new Color(COLORS.mint)]; gradient.locations = [0, 0.58, 1]; widget.backgroundGradient = gradient; widget.setPadding(14, 14, 14, 14);
  const account = selectAccount(cache.accounts || [], settings); const diagnostic = loadDiagnostic();
  widget.url = family === "small" ? buildDeepLink("refresh") : buildDeepLink("panel");
  const top = widget.addStack(); top.centerAlignContent(); const icon = top.addImage(SFSymbol.named("bolt.fill").image); icon.tintColor = new Color(COLORS.white); icon.imageSize = new Size(17, 17); top.addSpacer(7); const title = top.addText(settings.displayName || account?.name || "国家电网"); title.font = Font.semiboldSystemFont(15); title.textColor = new Color(COLORS.white); top.addSpacer();
  const refresh = top.addText("↻"); refresh.font = Font.boldSystemFont(18); refresh.textColor = new Color(COLORS.success); refresh.url = buildDeepLink("refresh");
  if (!account) { widget.addSpacer(); const empty = widget.addText("请打开脚本配置账号并更新数据"); empty.font = Font.systemFont(13); empty.textColor = new Color(COLORS.muted); widget.addSpacer(); return widget; }
  widget.addSpacer(10); const balance = widget.addText(money(account.balance)); balance.font = Font.boldSystemFont(family === "small" ? 27 : 31); balance.textColor = new Color(COLORS.white);
  const label = widget.addText("账户余额"); label.font = Font.systemFont(10); label.textColor = new Color(COLORS.muted);
  widget.addSpacer(10); const metrics = widget.addStack(); metric(metrics, "本月用电", kwh(account.monthKwh)); metrics.addSpacer(8); metric(metrics, "上月账单", money(account.previousMonthFee));
  if (family !== "small") { widget.addSpacer(8); const status = widget.addStack(); status.backgroundColor = new Color("FFFFFF", 0.12); status.cornerRadius = 9; status.setPadding(6, 8, 6, 8); const text = status.addText(`诊断 ${formatTime(diagnostic.at)}  ${diagnostic.message}`); text.font = Font.systemFont(9); text.textColor = new Color(diagnostic.kind === "error" ? COLORS.danger : COLORS.muted); text.lineLimit = 1; }
  widget.addSpacer(); const foot = widget.addText(cache.updatedAt ? `更新于 ${formatTime(cache.updatedAt)}` : "尚未更新"); foot.font = Font.systemFont(9); foot.textColor = new Color(COLORS.muted);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000); return widget;
}
function metric(parent, label, value) { const box = parent.addStack(); box.layoutVertically(); box.backgroundColor = new Color("FFFFFF", 0.12); box.cornerRadius = 10; box.setPadding(7, 8, 7, 8); const l = box.addText(label); l.font = Font.systemFont(9); l.textColor = new Color(COLORS.muted); const v = box.addText(value); v.font = Font.semiboldSystemFont(12); v.textColor = new Color(COLORS.white); }

function normalizeAccounts(payload) {
  const root = payload?.data || payload?.result || payload;
  const list = Array.isArray(root) ? root : Array.isArray(root?.accounts) ? root.accounts : Array.isArray(root?.data) ? root.data : root ? [root] : [];
  return list.map((item) => {
    const user = item.userInfo || item.consInfo || item;
    const bill = item.eleBill || item.bill || item.billInfo || item;
    const daily = item.dayElecQuantity31 || item.dayElecQuantity || {};
    const days = (daily.sevenEleList || daily.result || item.recentUsageList || []).map((row) => ({ day: text(row.day || row.date), kwh: number(row.dayElePq ?? row.power ?? row.electricity ?? row.value) })).filter((row) => row.kwh != null);
    const monthly = item.monthElecQuantity || {};
    const lastYear = item.lastYearElecQuantity || {};
    const monthRows = [...(lastYear.mothEleList || lastYear.monthEleList || []), ...(monthly.mothEleList || monthly.monthEleList || item.monthlyBill || item.monthList || item.months || [])];
    const months = monthRows.map((row) => ({ month: text(row.month || row.date || row.monthEleDate), kwh: number(row.monthEleNum ?? row.power), fee: number(row.monthEleCost ?? row.fee ?? row.sumMoney ?? row.charge) }));
    const previous = previousMonthRecord(months);
    const monthSum = sumCurrentMonth(days);
    return {
      accountNumber: text(user.consNo_dst || user.consNo || bill.consNo || item.consNo || item.accountNumber),
      name: text(user.consName_dst || user.consName || item.consName || item.name || "国家电网"),
      balance: number(bill.accountBalance ?? bill.balance ?? bill.sumMoney ?? item.balance),
      monthKwh: monthSum ?? number(bill.monthKwh ?? bill.totalPq ?? item.monthKwh ?? item.currentUsage ?? daily.totalPq),
      previousMonthFee: number(previous?.fee ?? item.previousMonthFee ?? item.lastMonthBill),
      updatedAt: text(bill.date || item.updatedAt || new Date().toISOString()),
    };
  }).filter((x) => x.accountNumber || x.balance != null || x.monthKwh != null || x.previousMonthFee != null);
}
function sumCurrentMonth(days, now = new Date()) { const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`; const rows = (days || []).filter((row) => String(row.day || "").replace(/\D/g, "").startsWith(prefix)); return rows.length ? rows.reduce((sum, row) => sum + row.kwh, 0) : null; }
function previousMonthRecord(rows, now = new Date()) { const date = new Date(now); date.setDate(1); date.setMonth(date.getMonth() - 1); const target = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`; return (rows || []).find((x) => monthKey(x.month || x.monthEleNum || x.ym || x.date) === target) || null; }
function monthKey(v) { const m = String(v || "").match(/(20\d{2})\D?([01]?\d)/); return m ? `${m[1]}${String(Number(m[2])).padStart(2, "0")}` : ""; }
function selectAccount(accounts, settings) { return accounts[Math.max(0, Number(settings.accountIndex) || 0)] || accounts[0] || null; }
function safeDiagnostic(error) { const m = String(error?.message || error || ""); if (/频繁|次日|-100/.test(m)) return "国网限制登录频率，请明天再试"; if (/验证码|风控|RK00|RK1003/.test(m)) return "国网登录验证未通过"; if (/账号|密码|登录失败/.test(m) && !/password\s*=|token|https?:\/\//i.test(m)) return "账号或密码不正确"; if (/超时|timeout/i.test(m)) return "查询服务超时"; if (/下载/.test(m)) return "查询引擎下载失败"; return "查询服务返回异常"; }
function buildDeepLink(action, params = {}) { const q = { scriptName: "StateGrid", action, ...params }; return `scriptable:///run?${Object.entries(q).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`; }
async function clearLocalData() { const a = new Alert(); a.title = "清除本地数据"; a.message = "将删除 Keychain 中的账号密码，以及本地缓存和诊断。"; a.addDestructiveAction("清除"); a.addCancelAction("取消"); if (await a.presentAlert() !== 0) return; if (Keychain.contains(KEYS.settings)) Keychain.remove(KEYS.settings); Object.values(FILES).forEach(removeLocal); }
async function showMessage(title, message) { const a = new Alert(); a.title = title; a.message = message; a.addAction("好"); await a.presentAlert(); }
function formatTime(v) { if (!v) return "--:--"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "--:--" : `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function money(v) { return v == null ? "--" : `¥${Number(v).toFixed(2)}`; }
function kwh(v) { return v == null ? "--" : `${Number(v).toFixed(2)} kWh`; }
function number(v) { if (v == null || v === "") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function text(v) { return v == null ? "" : String(v); }
