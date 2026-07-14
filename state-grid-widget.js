const STORAGE_KEY = "state_grid_widget_v2";
const STATUS_KEY = "state_grid_capture_status_v2";
const VERSION = "1.5.1";
const PROVIDER_SOURCE_KEY = "state_grid_provider_source_v1";
const DIAGNOSTIC_KEY = "state_grid_diagnostic_v1";
const PROVIDER_URL = "https://raw.githubusercontent.com/Yuheng0101/X/9ea8da5ce1d83572e937fa5d6882edb8382c4c30/Tasks/95598/95598.js";
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
  const updateMode = env.RUN_MODE === "update";

  if (updateMode && env.SGCC_USERNAME && env.SGCC_PASSWORD) {
    resetDiagnostic(ctx);
    addDiagnostic(ctx, "开始查询");
    try {
      const remote = normalizePayload(await fetchOfficialData(ctx, env));
      if (remote.length) {
        accounts = mergeAccounts(accounts, remote);
        ctx.storage.setJSON(STORAGE_KEY, { accounts, updatedAt: new Date().toISOString(), source: "网上国网网页接口" });
        ctx.storage.setJSON(STATUS_KEY, { kind: "success", hitAt: new Date().toISOString(), message: `已主动查询 ${remote.length} 个户号` });
        addDiagnostic(ctx, `查询成功：${remote.length} 个户号`);
      } else {
        addDiagnostic(ctx, "查询结束，但没有返回户号数据");
      }
    } catch (error) {
      const message = providerError(error);
      ctx.storage.setJSON(STATUS_KEY, { kind: "error", hitAt: new Date().toISOString(), message });
      addDiagnostic(ctx, `查询失败：${message}`);
      console.log(`[国家电网] 主动查询失败: ${String(error)}`);
    }
  }

  if (env.DATA_URL) {
    try {
      const response = await ctx.http.get(env.DATA_URL, { timeout: 12000 });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
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

  if (!account) return emptyWidget(family, ctx.storage.getJSON(STATUS_KEY) || captureStatus, env, updateMode);
  if (env.DISPLAY_NAME) account.name = env.DISPLAY_NAME;
  if (family === "accessoryInline") return inlineWidget(account);
  if (family === "accessoryCircular") return circularWidget(account);
  if (family === "accessoryRectangular") return lockWidget(account);
  if (family === "systemSmall") return smallWidget(account, env);
  return mediumWidget(account, env, family === "systemLarge" || family === "systemExtraLarge");
}

async function fetchOfficialData(ctx, env) {
  let source = ctx.storage.get(PROVIDER_SOURCE_KEY);
  if (!source || source.length < 50000) {
    addDiagnostic(ctx, "下载查询引擎");
    const response = await ctx.http.get(PROVIDER_URL, { timeout: 20000 });
    if (response.status < 200 || response.status >= 300) throw new Error(`查询引擎下载失败：HTTP ${response.status}`);
    source = await response.text();
    if (!source || source.length < 50000) throw new Error("查询引擎内容不完整");
    try { ctx.storage.set(PROVIDER_SOURCE_KEY, source); }
    catch (_) { console.log("[国家电网] 查询引擎缓存写入失败，本次继续运行"); }
    addDiagnostic(ctx, "查询引擎已就绪");
  } else {
    addDiagnostic(ctx, "使用本地查询引擎");
  }
  addDiagnostic(ctx, "登录并查询网上国网");
  return runLegacyProvider(ctx, source, env);
}

function runLegacyProvider(ctx, source, env) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastNotice = "";
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const response = result?.response || result;
      if (!response?.body) {
        reject(new Error(lastNotice || "查询脚本没有返回数据"));
        return;
      }
      try { resolve(JSON.parse(response.body)); }
      catch (_) { reject(new Error("查询脚本返回的数据无法解析")); }
    };
    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("查询超时，请稍后再试"));
      }
    }, 85000);

    globalThis.$request = { method: "GET", url: "https://api.wsgw-rewrite.com/electricity/bill/all" };
    globalThis.Egern = globalThis.Egern || {};
    globalThis.$argument = {
      username: String(env.SGCC_USERNAME),
      password: String(env.SGCC_PASSWORD),
      service: "true",
      debug: env.SGCC_DEBUG || "false",
      notify_all_accounts: "true",
    };
    globalThis.$persistentStore = {
      read: (key) => ctx.storage.get(`provider:${key}`),
      write: (value, key) => {
        try {
          if (value == null) ctx.storage.delete(`provider:${key}`);
          else ctx.storage.set(`provider:${key}`, String(value));
          return true;
        } catch (_) { return false; }
      },
    };
    globalThis.$notification = {
      post: (title, subtitle, body) => {
        lastNotice = [title, subtitle, body].filter(Boolean).join("：");
        console.log(`[国家电网] ${lastNotice}`);
      },
    };
    globalThis.$done = finish;
    globalThis.$httpClient = legacyHttpClient(ctx);

    try { (0, eval)(source); }
    catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
}

function legacyHttpClient(ctx) {
  const call = (method) => (input, callback) => {
    const request = typeof input === "string" ? { url: input } : { ...input };
    const timeout = Math.max(1000, Math.min(120000, Number(request.timeout || 15) * 1000));
    const host = safeHost(request.url);
    addDiagnostic(ctx, `请求 ${host}`);
    const options = {
      headers: request.headers || {},
      body: request.body,
      timeout,
      redirect: request["auto-redirect"] === false ? "manual" : "follow",
      credentials: "include",
    };
    ctx.http[method](request.url, options).then(async (response) => {
      const body = await response.text();
      addDiagnostic(ctx, `${host} → HTTP ${response.status}`);
      callback(null, { status: response.status, headers: response.headers }, body);
    }).catch((error) => {
      addDiagnostic(ctx, `${host} → ${safeError(error)}`);
      callback(error, null, null);
    });
  };
  return {
    get: call("get"), post: call("post"), put: call("put"), delete: call("delete"),
    patch: call("patch"), head: call("head"), options: call("options"),
  };
}

function resetDiagnostic(ctx) {
  try { ctx.storage.setJSON(DIAGNOSTIC_KEY, { updatedAt: new Date().toISOString(), events: [] }); }
  catch (_) { /* diagnostic storage is best effort */ }
}

function addDiagnostic(ctx, message) {
  try {
    const trace = ctx.storage.getJSON(DIAGNOSTIC_KEY) || { events: [] };
    const events = Array.isArray(trace.events) ? trace.events.slice(-19) : [];
    events.push({ at: new Date().toISOString(), message: String(message).slice(0, 160) });
    ctx.storage.setJSON(DIAGNOSTIC_KEY, { updatedAt: new Date().toISOString(), events });
  } catch (_) { /* diagnostic storage is best effort */ }
}

function safeHost(url) {
  const match = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return match ? match[1] : "未知接口";
}

function safeError(error) {
  return String(error?.message || error || "请求失败")
    .replace(/https?:\/\/[^\s]+/g, "[URL]")
    .slice(0, 100);
}

function providerError(error) {
  const message = String(error?.message || error || "未知错误");
  if (/密码|账号/.test(message)) return "账号或密码未配置/不正确";
  if (/频繁|-100/.test(message)) return "国网限制登录频率，请明天再试";
  if (/验证码|风控/.test(message)) return "国网登录验证未通过，请稍后重试";
  return message.slice(0, 90);
}

function normalizePayload(payload) {
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [payload];
  return source.map(normalizeAccount).filter(Boolean);
}

function normalizeAccount(item) {
  if (!item || typeof item !== "object") return null;
  const bill = item.eleBill || item.bill || findObject(item, ["sumMoney", "accountBalance"]) || {};
  const user = item.userInfo || findObject(item, ["consNo_dst", "consName_dst"]) || {};
  const daily = item.dayElecQuantity31 || item.dayElecQuantity || findObject(item, ["sevenEleList"]) || {};
  const monthly = item.monthElecQuantity || findObject(item, ["mothEleList"]) || {};
  const lastYearMonthly = item.lastYearElecQuantity || {};
  const dayRows = daily.sevenEleList || daily.result || item.recentUsageList || [];
  const days = dayRows.map((row) => ({
    day: text(row.day || row.date),
    kwh: number(row.dayElePq ?? row.power ?? row.electricity ?? row.value ?? row.formattedValue),
  })).filter((row) => row.kwh != null);
  const monthRows = [
    ...(lastYearMonthly.mothEleList || lastYearMonthly.monthEleList || lastYearMonthly.result || []),
    ...(monthly.mothEleList || monthly.monthEleList || monthly.result || []),
  ];
  const months = monthRows.map((row) => ({
    month: text(row.month || row.date || row.monthEleDate),
    kwh: number(row.monthEleNum ?? row.power),
    fee: number(row.monthEleCost ?? row.charge),
  }));
  const previousBill = previousMonthRecord(months);
  const flatPreviousKwh = number(item.previousMonthUsage ?? item.previousMonthKwh);
  const flatPreviousFee = number(item.previousMonthCost ?? item.previousMonthFee ?? item.lastMonthBill);
  const hasFlatPreviousBill = flatPreviousKwh != null || flatPreviousFee != null;
  const currentMonthKwh = sumCurrentMonth(days);
  const balanceRaw = number(bill.accountBalance ?? bill.balance ?? item.balance);
  const sumMoney = number(bill.sumMoney ?? bill.amount);
  const overdue = Boolean(item.arrearsOfFees || item.isOwe) || number(bill.historyOwe) > 0 || (sumMoney != null && sumMoney < 0);
  const accountNumber = text(user.consNo_dst || user.consNo || bill.consNo || item.consNo || item.accountNumber);
  const previousMonthFee = previousBill?.fee ?? flatPreviousFee;

  if (!accountNumber && balanceRaw == null && sumMoney == null && !days.length && !months.length && previousMonthFee == null) return null;
  return {
    accountNumber,
    name: text(user.consName_dst || user.consName || item.consName || item.name || "国家电网"),
    address: text(user.eleAddress || user.address || item.address),
    balance: balanceRaw ?? sumMoney,
    overdue,
    monthKwh: currentMonthKwh
      ?? number(bill.totalPq)
      ?? number(item.currentUsage ?? item.monthKwh)
      ?? number(daily.totalPq ?? daily.totalPower),
    previousMonth: previousBill?.month || (hasFlatPreviousBill ? previousMonthLabel() : text(item.previousMonth)),
    previousMonthKwh: previousBill?.kwh ?? flatPreviousKwh,
    previousMonthFee,
    // v2 cache alias only; legacy monthFee input is intentionally not trusted as an "上月账单".
    monthFee: previousMonthFee,
    yearKwh: number(monthly?.dataInfo?.totalEleNum ?? item.annualUsage ?? item.yearKwh),
    yearFee: number(monthly?.dataInfo?.totalEleCost ?? item.annualCost ?? item.yearFee),
    latestKwh: days.length ? days[days.length - 1].kwh : number(item.latestKwh),
    latestDay: days.length ? days[days.length - 1].day : text(item.latestDay),
    days,
    updatedAt: text(bill.date || item.billDate || item.updatedAt || new Date().toISOString()),
  };
}

function accountFromEnv(env) {
  const values = [env.BALANCE, env.MONTH_KWH, env.LAST_MONTH_BILL, env.YEAR_KWH, env.YEAR_FEE];
  if (!env.ACCOUNT && !values.some((value) => value != null && value !== "")) return null;
  return {
    accountNumber: text(env.ACCOUNT),
    name: text(env.DISPLAY_NAME || "我的用电"),
    address: text(env.ADDRESS),
    balance: number(env.BALANCE),
    overdue: env.OVERDUE === "true",
    monthKwh: number(env.MONTH_KWH),
    previousMonth: env.LAST_MONTH_BILL ? previousMonthLabel() : "",
    previousMonthFee: number(env.LAST_MONTH_BILL),
    monthFee: number(env.LAST_MONTH_BILL),
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
        metric("上月账单", money(a.previousMonthFee), "sf-symbol:creditcard.fill", WHITE),
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
      { type: "text", text: `上月账单 ${money(a.previousMonthFee)}`, font: { size: "caption2" }, textColor: MUTED, maxLines: 1, minScale: 0.7 },
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

function emptyWidget(family, captureStatus, env, updateMode) {
  const compact = family.startsWith("accessory");
  const message = (!env.SGCC_USERNAME || !env.SGCC_PASSWORD)
    ? (compact ? "请配置国网账号" : "请在模块设置中填写网上国网账号和密码")
    : (!updateMode && !captureStatus)
      ? (compact ? "请先更新数据" : "请在小组件画廊中运行“国家电网·更新数据”")
      : captureStatusMessage(captureStatus, compact);
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
  if (!status) return compact ? "等待查询" : "尚未完成首次查询，请刷新小组件";
  if (status.kind === "error") return compact ? "查询失败" : `查询失败：${String(status.message || "未知错误").slice(0, 80)}`;
  if (status.kind === "success") return compact ? "已更新" : String(status.message || "网上国网数据已更新");
  return compact ? "等待账户数据" : String(status.message || "正在等待网上国网返回数据");
}

function inlineWidget(a) { return { type: "widget", children: [{ type: "text", text: `⚡ 余额 ${money(a.balance)} · 本月 ${kwh(a.monthKwh)} · 上月 ${money(a.previousMonthFee)}` }] }; }
function circularWidget(a) { return { type: "widget", children: [{ type: "image", src: "sf-symbol:bolt.fill" }, { type: "text", text: format(a.monthKwh, 0), font: { size: "caption1", weight: "bold" }, maxLines: 1 }] }; }
function lockWidget(a) { return { type: "widget", gap: 2, children: [{ type: "text", text: `⚡ ${a.overdue ? "电费欠费" : "国家电网"}`, font: { size: "caption1", weight: "bold" }, maxLines: 1 }, { type: "text", text: `余额 ${money(a.balance)} · 本月 ${kwh(a.monthKwh)} · 上月 ${money(a.previousMonthFee)}`, font: { size: "caption2" }, maxLines: 1, minScale: 0.6 }] }; }

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

function previousMonthRecord(months, now = new Date()) {
  const targetKey = previousMonthKey(now);
  const row = (months || []).find((item) => monthKey(item?.month) === targetKey);
  if (!row) return null;
  return {
    month: `${targetKey.slice(0, 4)}-${targetKey.slice(4)}`,
    kwh: number(row.kwh),
    fee: number(row.fee),
  };
}

function previousMonthLabel(now = new Date()) {
  const key = previousMonthKey(now);
  return `${key.slice(0, 4)}-${key.slice(4)}`;
}

function previousMonthKey(now = new Date()) {
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
}

function monthKey(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : "";
}

function number(value) { if (value == null || value === "" || value === "-") return null; const n = Number(String(value).replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function text(value) { return value == null ? "" : String(value); }
function format(value, digits = 2) { return number(value) == null ? "--" : Number(value).toFixed(digits); }
function money(value) { return number(value) == null ? "--" : `¥${format(value)}`; }
function kwh(value) { return number(value) == null ? "--" : `${format(value)} kWh`; }
function mask(value) { const s = text(value); return s.length > 8 ? `${s.slice(0, 4)}••••${s.slice(-4)}` : (s || "未绑定户号"); }
function updateLabel(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "已缓存" : `更新 ${d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`; }
