const STORAGE_KEY = "state_grid_widget_v1";
const STATUS_KEY = "state_grid_capture_status_v1";
const VERSION = "1.2.0";
const GREEN = "#00A88F";
const GREEN_DARK = "#00796B";
const WHITE = "#FFFFFF";
const MUTED = "#FFFFFFB8";
const CARD = "#FFFFFF1F";

export default async function (ctx) {
  try {
    return await renderWidget(ctx);
  } catch (error) {
    return fatalWidget(ctx?.widgetFamily, error);
  }
}

async function renderWidget(ctx) {
  const family = ctx.widgetFamily || "systemMedium";
  const env = ctx.env || {};
  const stored = ctx.storage.getJSON(STORAGE_KEY) || { accounts: [] };
  const captureStatus = ctx.storage.getJSON(STATUS_KEY) || null;
  let accounts = Array.isArray(stored.accounts) ? stored.accounts : [];

  if (env.DATA_URL) {
    try {
      const response = await ctx.http.get(env.DATA_URL, { timeout: 12000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remote = normalizePayload(await response.json());
      if (remote.length) {
        accounts = mergeAccounts(accounts, remote);
        ctx.storage.setJSON(STORAGE_KEY, { accounts, updatedAt: new Date().toISOString() });
      }
    } catch (error) {
      console.log(`[国家电网] DATA_URL 获取失败: ${String(error)}`);
    }
  }

  const manual = accountFromEnv(env);
  if (manual) accounts = mergeAccounts(accounts, [manual]);
  const index = Math.max(0, Number.parseInt(env.ACCOUNT_INDEX || "0", 10) || 0);
  const account = accounts[index] || accounts[0] || null;

  if (!account) return emptyWidget(family, captureStatus);
  if (env.DISPLAY_NAME) account.name = env.DISPLAY_NAME;
  if (family === "accessoryInline") return inlineWidget(account);
  if (family === "accessoryCircular") return circularWidget(account);
  if (family === "accessoryRectangular") return lockWidget(account);
  if (family === "systemSmall") return smallWidget(account, env);
  return mediumWidget(account, env, family === "systemLarge" || family === "systemExtraLarge");
}

function normalizePayload(payload) {
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [payload];
  return source.map(normalizeAccount).filter(Boolean);
}

function normalizeAccount(item) {
  if (!item || typeof item !== "object") return null;
  const bill = item.eleBill || item.bill || findObject(item, ["sumMoney", "accountBalance"] ) || {};
  const user = item.userInfo || findObject(item, ["consNo_dst", "consName_dst"]) || {};
  const daily = item.dayElecQuantity31 || item.dayElecQuantity || findObject(item, ["sevenEleList"]) || {};
  const monthly = item.monthElecQuantity || findObject(item, ["mothEleList"]) || {};
  const days = (daily.sevenEleList || []).map((row) => ({
    day: text(row.day || row.date),
    kwh: number(row.dayElePq ?? row.power ?? row.electricity),
  })).filter((row) => row.kwh != null);
  const months = (monthly.mothEleList || []).map((row) => ({
    month: text(row.month || row.date),
    kwh: number(row.monthEleNum ?? row.power),
    fee: number(row.monthEleCost ?? row.charge),
  }));
  const latestMonth = months.filter((row) => row.kwh != null || row.fee != null).slice(-1)[0] || {};
  const currentMonthKwh = sumCurrentMonth(days);
  const balanceRaw = number(bill.accountBalance ?? bill.balance);
  const sumMoney = number(bill.sumMoney ?? bill.amount);
  const overdue = Boolean(item.arrearsOfFees) || number(bill.historyOwe) > 0 || (sumMoney != null && sumMoney < 0);
  const accountNumber = text(user.consNo_dst || user.consNo || bill.consNo || item.accountNumber);

  if (!accountNumber && balanceRaw == null && sumMoney == null && !days.length && !months.length) return null;
  return {
    accountNumber,
    name: text(user.consName_dst || user.consName || item.name || "国家电网"),
    address: text(user.eleAddress || user.address),
    balance: balanceRaw ?? sumMoney,
    overdue,
    monthKwh: currentMonthKwh || number(item.monthKwh) || latestMonth.kwh,
    monthFee: number(item.monthFee) ?? latestMonth.fee,
    yearKwh: number(monthly?.dataInfo?.totalEleNum ?? item.yearKwh),
    yearFee: number(monthly?.dataInfo?.totalEleCost ?? item.yearFee),
    latestKwh: days.length ? days[days.length - 1].kwh : number(item.latestKwh),
    latestDay: days.length ? days[days.length - 1].day : text(item.latestDay),
    days,
    updatedAt: text(bill.date || item.updatedAt || new Date().toISOString()),
  };
}

function accountFromEnv(env) {
  const values = [env.BALANCE, env.MONTH_KWH, env.MONTH_FEE, env.YEAR_KWH, env.YEAR_FEE];
  if (!env.ACCOUNT && !values.some((value) => value != null && value !== "")) return null;
  return {
    accountNumber: text(env.ACCOUNT),
    name: text(env.DISPLAY_NAME || "我的用电"),
    address: text(env.ADDRESS),
    balance: number(env.BALANCE),
    overdue: env.OVERDUE === "true",
    monthKwh: number(env.MONTH_KWH),
    monthFee: number(env.MONTH_FEE),
    yearKwh: number(env.YEAR_KWH),
    yearFee: number(env.YEAR_FEE),
    latestKwh: number(env.LATEST_KWH),
    latestDay: text(env.LATEST_DAY),
    days: [],
    updatedAt: new Date().toISOString(),
  };
}

function mediumWidget(a, env, expanded) {
  const openURL = env.OPEN_URL || "https://www.95598.cn/osgweb/index";
  const children = [
    header(a),
    { type: "spacer" },
    {
      type: "stack", direction: "row", gap: 10, children: [
        metric("电费余额", money(a.balance), "sf-symbol:yensign.circle.fill", a.overdue ? "#FFCCCB" : WHITE),
        metric("本月用电", kwh(a.monthKwh), "sf-symbol:bolt.fill", WHITE),
        metric("本月电费", money(a.monthFee), "sf-symbol:creditcard.fill", WHITE),
      ],
    },
    { type: "spacer" },
    {
      type: "stack", direction: "row", alignItems: "center", gap: 7, children: [
        { type: "image", src: "sf-symbol:clock.arrow.circlepath", width: 12, height: 12, color: MUTED },
        { type: "text", text: updateLabel(a.updatedAt), font: { size: "caption2" }, textColor: MUTED, maxLines: 1 },
        { type: "spacer" },
        { type: "text", text: a.overdue ? "存在欠费" : "账户正常", font: { size: "caption2", weight: "semibold" }, textColor: a.overdue ? "#FFD5D2" : "#C8FFF2" },
      ],
    },
  ];
  if (expanded) children.splice(3, 0, recentDays(a.days));
  return {
    type: "widget", url: openURL, padding: 16, gap: 5, children,
    backgroundGradient: { type: "linear", colors: [GREEN, GREEN_DARK], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

function smallWidget(a, env) {
  return {
    type: "widget", url: env.OPEN_URL || "https://www.95598.cn/osgweb/index", padding: 15, gap: 7,
    backgroundGradient: { type: "linear", colors: [GREEN, GREEN_DARK], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    children: [
      { type: "stack", direction: "row", alignItems: "center", gap: 7, children: [
        { type: "image", src: "sf-symbol:bolt.house.fill", width: 20, height: 20, color: WHITE },
        { type: "text", text: "国家电网", font: { size: "headline", weight: "bold" }, textColor: WHITE, maxLines: 1, minScale: 0.75 },
      ] },
      { type: "spacer" },
      { type: "text", text: a.overdue ? "当前欠费" : "账户余额", font: { size: "caption1" }, textColor: MUTED },
      { type: "text", text: money(a.balance), font: { size: "title", weight: "bold" }, textColor: WHITE, maxLines: 1, minScale: 0.55 },
      { type: "spacer" },
      { type: "text", text: `本月 ${kwh(a.monthKwh)}`, font: { size: "caption1", weight: "medium" }, textColor: WHITE, maxLines: 1, minScale: 0.7 },
      { type: "text", text: mask(a.accountNumber), font: { size: "caption2" }, textColor: MUTED, maxLines: 1 },
    ],
  };
}

function header(a) {
  return { type: "stack", direction: "row", alignItems: "center", gap: 8, children: [
    { type: "image", src: "sf-symbol:bolt.house.fill", width: 22, height: 22, color: WHITE },
    { type: "stack", direction: "column", alignItems: "start", gap: 1, children: [
      { type: "text", text: a.name || "国家电网", font: { size: "headline", weight: "bold" }, textColor: WHITE, maxLines: 1 },
      { type: "text", text: mask(a.accountNumber), font: { size: "caption2" }, textColor: MUTED, maxLines: 1 },
    ] },
    { type: "spacer" },
    { type: "stack", padding: [4, 7], borderRadius: 9, backgroundColor: CARD, children: [
      { type: "text", text: "网上国网", font: { size: "caption2", weight: "semibold" }, textColor: WHITE },
    ] },
  ] };
}

function metric(title, value, icon, color) {
  return { type: "stack", direction: "column", alignItems: "start", flex: 1, gap: 5, padding: 10, borderRadius: 13, backgroundColor: CARD, children: [
    { type: "stack", direction: "row", gap: 5, children: [
      { type: "image", src: icon, width: 13, height: 13, color },
      { type: "text", text: title, font: { size: "caption2" }, textColor: MUTED, maxLines: 1 },
    ] },
    { type: "text", text: value, font: { size: "subheadline", weight: "bold" }, textColor: color, maxLines: 1, minScale: 0.52 },
  ] };
}

function recentDays(days) {
  const recent = (days || []).slice(-7);
  const max = Math.max(1, ...recent.map((x) => x.kwh || 0));
  return { type: "stack", direction: "column", gap: 6, padding: 10, borderRadius: 13, backgroundColor: CARD, children: [
    { type: "text", text: "近 7 日用电", font: { size: "caption1", weight: "semibold" }, textColor: WHITE },
    { type: "stack", direction: "row", alignItems: "end", gap: 5, children: recent.map((x) => ({
      type: "stack", direction: "column", alignItems: "center", flex: 1, gap: 3, children: [
        { type: "text", text: format(x.kwh, 1), font: { size: "caption2" }, textColor: MUTED, minScale: 0.5 },
        { type: "stack", width: 10, height: Math.max(4, Math.round(34 * x.kwh / max)), borderRadius: 5, backgroundColor: "#C8FFF2" },
      ],
    })) },
  ] };
}

function emptyWidget(family, captureStatus) {
  const compact = family.startsWith("accessory");
  const message = captureStatusMessage(captureStatus, compact);
  return { type: "widget", padding: compact ? 5 : 16, gap: 7, backgroundColor: GREEN_DARK, children: [
    { type: "image", src: "sf-symbol:bolt.house.fill", width: compact ? 16 : 28, height: compact ? 16 : 28, color: WHITE },
    { type: "text", text: `国家电网 · v${VERSION}`, font: { size: compact ? "caption1" : "headline", weight: "bold" }, textColor: WHITE },
    { type: "text", text: message, font: { size: "caption1" }, textColor: MUTED, maxLines: compact ? 1 : 3 },
  ] };
}

function fatalWidget(family, error) {
  const compact = String(family || "").startsWith("accessory");
  return {
    type: "widget",
    padding: compact ? 5 : 14,
    gap: 6,
    backgroundColor: "#8B1E1E",
    children: [
      { type: "text", text: `国家电网 · v${VERSION}`, font: { size: "headline", weight: "bold" }, textColor: WHITE, maxLines: 1 },
      { type: "text", text: compact ? "运行错误" : `运行错误：${String(error?.message || error).slice(0, 160)}`, font: { size: "caption1" }, textColor: WHITE, maxLines: compact ? 1 : 4 },
    ],
  };
}

function captureStatusMessage(status, compact) {
  if (!status) return compact ? "未检测到数据" : "未检测到网上国网请求，请确认 Egern 隧道、模块和 MitM 已开启";
  if (status.kind === "non-json") return compact ? "响应非 JSON" : "已检测到网上国网请求，但响应不是 JSON；请再打开用电量或账单详情";
  if (status.kind === "unrecognized") return compact ? "字段未识别" : "已捕获网上国网响应，但当前省份的接口字段尚未识别";
  if (status.kind === "error") return compact ? "采集出错" : `采集脚本出错：${String(status.message || "未知错误").slice(0, 80)}`;
  return compact ? "等待账户数据" : String(status.message || "已命中请求，等待账户数据");
}

function inlineWidget(a) { return { type: "widget", children: [{ type: "text", text: `⚡ ${a.overdue ? "欠费" : "余额"} ${money(a.balance)} · 本月 ${kwh(a.monthKwh)}` }] }; }
function circularWidget(a) { return { type: "widget", children: [{ type: "image", src: "sf-symbol:bolt.fill" }, { type: "text", text: format(a.monthKwh, 0), font: { size: "caption1", weight: "bold" }, maxLines: 1 }] }; }
function lockWidget(a) { return { type: "widget", gap: 2, children: [{ type: "text", text: `⚡ ${a.overdue ? "电费欠费" : "国家电网"}`, font: { size: "caption1", weight: "bold" }, maxLines: 1 }, { type: "text", text: `余额 ${money(a.balance)}  本月 ${kwh(a.monthKwh)}`, font: { size: "caption2" }, maxLines: 1 }] }; }

function findObject(root, keys) {
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return value;
    for (const child of Object.values(value)) if (child && typeof child === "object") queue.push(child);
  }
  return null;
}

function mergeAccounts(oldItems, newItems) {
  const result = [...oldItems];
  for (const item of newItems) {
    const index = result.findIndex((x) => item.accountNumber && x.accountNumber === item.accountNumber);
    if (index >= 0) result[index] = { ...result[index], ...item };
    else result.push(item);
  }
  return result.slice(0, 10);
}

function sumCurrentMonth(days) {
  const now = new Date();
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const matched = days.filter((x) => text(x.day).replace(/\D/g, "").startsWith(prefix));
  return matched.length ? matched.reduce((sum, x) => sum + (x.kwh || 0), 0) : null;
}

function number(value) { if (value == null || value === "" || value === "-") return null; const n = Number(String(value).replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function text(value) { return value == null ? "" : String(value); }
function format(value, digits = 2) { return number(value) == null ? "--" : Number(value).toFixed(digits); }
function money(value) { return number(value) == null ? "--" : `¥${format(value)}`; }
function kwh(value) { return number(value) == null ? "--" : `${format(value)} kWh`; }
function mask(value) { const s = text(value); return s.length > 8 ? `${s.slice(0, 4)}••••${s.slice(-4)}` : (s || "未绑定户号"); }
function updateLabel(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "已缓存" : `更新 ${d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`; }
