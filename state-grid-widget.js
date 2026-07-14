const STORAGE_KEY = "state_grid_widget_v2";
const STATUS_KEY = "state_grid_capture_status_v2";
const VERSION = "1.6.3";
const PROVIDER_SOURCE_KEY = "state_grid_provider_source_v1";
const DIAGNOSTIC_KEY = "state_grid_diagnostic_v1";
const PROVIDER_URL = "https://raw.githubusercontent.com/Yuheng0101/X/9ea8da5ce1d83572e937fa5d6882edb8382c4c30/Tasks/95598/95598.js";
const INK = "#16213A";
const TEAL = "#0B7285";
const MINT = "#25A18E";
const WHITE = "#FFFFFF";
const MUTED = "#FFFFFFB8";
const GLASS = "#FFFFFF1A";
const GLASS_STRONG = "#FFFFFF2E";
const GLASS_LINE = "#FFFFFF26";
const SUCCESS = "#BFFFE7";
const DANGER = "#FFD4D1";
const BACKGROUND = { type: "linear", colors: [INK, TEAL, MINT], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };

export default async function (ctx) {
  try {
    return await renderWidget(ctx);
  } catch (_) {
    return fatalWidget(ctx?.widgetFamily);
  }
}

async function renderWidget(ctx) {
  const family = ctx.widgetFamily || "systemMedium";
  const env = ctx.env || {};
  const stored = ctx.storage.getJSON(STORAGE_KEY) || { accounts: [] };
  const captureStatus = ctx.storage.getJSON(STATUS_KEY) || null;
  const diagnostic = ctx.storage.getJSON(DIAGNOSTIC_KEY) || null;
  let accounts = Array.isArray(stored.accounts) ? stored.accounts : [];
  const updateMode = env.RUN_MODE === "update";

  if (updateMode && env.SGCC_USERNAME && env.SGCC_PASSWORD) {
    resetDiagnostic(ctx);
    setUpdateStatus(ctx, "pending", "正在登录并查询网上国网");
    addDiagnostic(ctx, "开始查询");
    try {
      const remote = normalizePayload(await fetchOfficialData(ctx, env));
      if (remote.length) {
        accounts = mergeAccounts(accounts, remote);
        ctx.storage.setJSON(STORAGE_KEY, { accounts, updatedAt: new Date().toISOString(), source: "网上国网网页接口" });
        setUpdateStatus(ctx, "success", `已主动查询 ${remote.length} 个户号`);
        addDiagnostic(ctx, `查询成功：${remote.length} 个户号`);
      } else {
        setUpdateStatus(ctx, "empty", "查询完成，但没有返回户号数据");
        addDiagnostic(ctx, "查询结束，但没有返回户号数据");
      }
    } catch (error) {
      const message = providerError(error, env);
      setUpdateStatus(ctx, "error", message);
      addDiagnostic(ctx, `查询失败：${message}`);
      console.log(`[国家电网] ${message}`);
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
    } catch (_) {
      console.log("[国家电网] 兼容数据接口获取失败");
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
  return mediumWidget(account, env, family === "systemLarge" || family === "systemExtraLarge", {
    trace: diagnostic,
    status: ctx.storage.getJSON(STATUS_KEY) || captureStatus,
  });
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
    const tracker = { count: 0, activeHost: "" };
    let remainingTimeout = 85000;
    const timeoutTick = 9000;
    const scheduleWatchdog = () => {
      const delay = Math.min(timeoutTick, remainingTimeout);
      timer = setTimeout(() => {
        if (settled) return;
        remainingTimeout -= delay;
        if (remainingTimeout <= 0) {
          settled = true;
          const host = tracker.activeHost || "查询引擎";
          addDiagnostic(ctx, `查询超时：停在 ${host}`);
          cleanup();
          reject(new Error("查询超时，请稍后再试"));
          return;
        }
        scheduleWatchdog();
      }, delay);
    };
    const cleanup = () => {
      globalThis.$argument = {};
      globalThis.$request = undefined;
      globalThis.$persistentStore = undefined;
      globalThis.$notification = undefined;
      globalThis.$done = undefined;
      globalThis.$httpClient = undefined;
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const response = result?.response || result;
      if (!response?.body) {
        reject(new Error(lastNotice || "查询脚本没有返回数据"));
        return;
      }
      try { resolve(JSON.parse(response.body)); }
      catch (_) { reject(new Error("查询脚本返回的数据无法解析")); }
    };
    scheduleWatchdog();

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
          const stringValue = value == null ? "" : String(value);
          if (containsCredential(stringValue, env)) return false;
          if (value == null) ctx.storage.delete(`provider:${key}`);
          else ctx.storage.set(`provider:${key}`, stringValue);
          return true;
        } catch (_) { return false; }
      },
    };
    globalThis.$notification = {
      post: (title, subtitle, body) => {
        const rawNotice = [title, subtitle, body].filter(Boolean).join("：");
        lastNotice = providerError(new Error(rawNotice), env);
        console.log(`[国家电网] ${lastNotice}`);
      },
    };
    globalThis.$done = finish;
    globalThis.$httpClient = legacyHttpClient(ctx, tracker, () => !settled);

    try { (0, eval)(source); }
    catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error(providerError(error, env)));
      }
    }
  });
}

function legacyHttpClient(ctx, tracker = { count: 0, activeHost: "" }, isActive = () => true) {
  const call = (method) => (input, callback) => {
    const request = typeof input === "string" ? { url: input } : { ...input };
    const timeout = Math.max(1000, Math.min(120000, Number(request.timeout || 15) * 1000));
    const host = safeHost(request.url);
    const requestId = ++tracker.count;
    tracker.activeHost = host;
    addDiagnostic(ctx, `#${requestId} 请求 ${host}`);
    const options = {
      headers: request.headers || {},
      body: request.body,
      timeout,
      redirect: request["auto-redirect"] === false ? "manual" : "follow",
      credentials: "include",
    };
    ctx.http[method](request.url, options).then(async (response) => {
      const body = await response.text();
      if (!isActive()) return;
      addDiagnostic(ctx, `#${requestId} ${host} → HTTP ${response.status} · ${responseKind(response.headers, body)} · ${bodyLength(body)}B`);
      const safePayloadStatus = safeProviderPayload(body);
      if (safePayloadStatus) addDiagnostic(ctx, `#${requestId} 结果：${safePayloadStatus}`);
      callback(null, { status: response.status, headers: response.headers }, body);
    }, (error) => {
      if (!isActive()) return;
      addDiagnostic(ctx, `#${requestId} ${host} → ${safeError(error)}`);
      callback(error, null, null);
    });
  };
  return {
    get: call("get"), post: call("post"), put: call("put"), delete: call("delete"),
    patch: call("patch"), head: call("head"), options: call("options"),
  };
}

function setUpdateStatus(ctx, kind, message) {
  try { ctx.storage.setJSON(STATUS_KEY, { kind, hitAt: new Date().toISOString(), message }); }
  catch (_) { /* status storage is best effort */ }
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
  const match = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
  if (!match) return "其他查询服务";
  const authority = match[1].slice(match[1].lastIndexOf("@") + 1);
  const hostname = (authority.startsWith("[")
    ? authority.slice(1, authority.indexOf("]"))
    : authority.split(":")[0]).toLowerCase();
  if (hostname === "api.120399.xyz" || hostname === "www.95598.cn") return hostname;
  return "其他查询服务";
}

function responseKind(headers, body) {
  let contentType = "";
  try { contentType = String(headers?.get?.("content-type") || headers?.["content-type"] || headers?.["Content-Type"] || "").toLowerCase(); }
  catch (_) { contentType = ""; }
  const sample = String(body || "").trim();
  if (contentType.includes("json") || /^[\[{]/.test(sample)) return "JSON";
  if (contentType.includes("html") || /^<!doctype|^<html/i.test(sample)) return "HTML";
  if (!sample) return "空响应";
  return "其他响应";
}

function safeProviderPayload(body) {
  const text = String(body || "").trim();
  if (!text || text.length > 2048 || !/^[\[{]/.test(text)) return "";
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { return ""; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";

  const code = String(payload.code ?? payload.errorCode ?? payload.statusCode ?? payload.resultCode ?? "");
  const message = String(payload.message ?? payload.msg ?? payload.error_description ?? payload.errorMessage ?? "");
  const signal = `${code} ${message}`;

  if (/-100\b|频繁|次日再次尝试|登录次数过多/.test(signal)) return "国网限制登录频率，请明天再试";
  if (/RK007|RK008|RK1003|验证码|风控|blockPuzzle|clickImg|clickWord/i.test(signal)) return "国网登录验证未通过，请稍后重试";
  if (/10002|Token\s*为空|登录态.*(?:无效|失效|过期)|WEB渠道KeyCode已失效/i.test(signal)) return "国网登录状态已失效，请重新查询";
  if (/解密|解析|decrypt|parse/i.test(signal)) return "查询服务响应解析失败，请稍后重试";
  if (/密码|账号|登录失败/.test(signal)) return "账号或密码未配置/不正确";
  return "";
}

function bodyLength(body) {
  return Math.min(999999, String(body || "").length);
}

function safeError(error) {
  const message = String(error?.message || error || "");
  if (/timeout|timed out|超时/i.test(message)) return "请求超时";
  return "网络请求失败";
}

function containsCredential(value, env) {
  const text = String(value || "");
  return [env?.SGCC_USERNAME, env?.SGCC_PASSWORD]
    .map((item) => String(item || ""))
    .filter((item) => item.length >= 4)
    .some((item) => text.includes(item));
}

function providerError(error, env = {}) {
  const message = String(error?.message || error || "");
  // Classify only fixed, non-sensitive categories before applying the final
  // redaction guard. Provider messages often include a help URL, which must
  // not erase a safe category such as rate limiting or login verification.
  if (/频繁|-100|次日再次尝试|登录次数过多/.test(message)) return "国网限制登录频率，请明天再试";
  if (/验证码|风控|RK007|RK008|RK1003/.test(message)) return "国网登录验证未通过，请稍后重试";
  if (/密码|账号|登录失败/.test(message)) return "账号或密码未配置/不正确";
  if (/查询引擎.*(?:下载|内容)/.test(message)) return "查询引擎下载失败，请检查网络";
  if (/timeout|timed out|超时/i.test(message)) return "查询服务超时，请稍后重试";
  if (/network|网络|连接|fetch|socket/i.test(message)) return "查询服务网络异常，请稍后重试";
  if (/没有返回数据/.test(message)) return "查询服务没有返回数据";
  if (/无法解析|解析失败|解密响应失败/.test(message)) return "查询服务响应解析失败，请稍后重试";
  if (containsCredential(message, env) || /bearer\s+|(?:token|password|passwd|authorization)\s*[:=]|https?:\/\//i.test(message)) {
    return "查询服务返回异常，请查看诊断步骤";
  }
  return "查询服务返回异常，请查看诊断步骤";
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

function mediumWidget(a, env, expanded, diagnostic) {
  const openURL = env.OPEN_URL || "https://www.95598.cn/osgweb/index";
  const children = [
    header(a),
    { type: "spacer" },
    {
      type: "stack", direction: "row", gap: 8, children: [
        metric("电费余额", money(a.balance), "sf-symbol:yensign", a.overdue ? DANGER : WHITE),
        metric("本月用电", kwh(a.monthKwh), "sf-symbol:bolt.fill", WHITE),
        metric("上月账单", money(a.previousMonthFee), "sf-symbol:doc.text.fill", WHITE),
      ],
    },
    diagnosticSummary(diagnostic),
    footer(a),
  ];
  if (expanded) children.splice(3, 0, recentDays(a.days));
  return {
    type: "widget", url: openURL, padding: 16, gap: 5, children,
    backgroundGradient: BACKGROUND,
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

function smallWidget(a, env) {
  return {
    type: "widget", url: env.OPEN_URL || "https://www.95598.cn/osgweb/index", padding: 14, gap: 6,
    backgroundGradient: BACKGROUND,
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    children: [
      { type: "stack", direction: "row", alignItems: "center", gap: 7, children: [
        symbolBadge("sf-symbol:bolt.fill", 14),
        { type: "text", text: a.name || "国家电网", font: { size: "subheadline", weight: "semibold" }, textColor: WHITE, maxLines: 1, minScale: 0.72 },
        { type: "spacer" },
        statusDot(a.overdue),
      ] },
      { type: "spacer" },
      { type: "text", text: a.overdue ? "待缴电费" : "账户余额", font: { size: "caption2", weight: "medium" }, textColor: MUTED },
      { type: "text", text: money(a.balance), font: { size: "title", weight: "bold" }, textColor: WHITE, maxLines: 1, minScale: 0.55 },
      { type: "spacer" },
      { type: "stack", direction: "column", gap: 4, padding: [7, 9], borderRadius: 11, backgroundColor: GLASS, children: [
        compactRow("本月用电", kwh(a.monthKwh)),
        { type: "stack", height: 1, backgroundColor: GLASS_LINE },
        compactRow("上月账单", money(a.previousMonthFee)),
      ] },
    ],
  };
}

function header(a) {
  return { type: "stack", direction: "row", alignItems: "center", gap: 9, children: [
    symbolBadge("sf-symbol:bolt.fill", 15),
    { type: "stack", direction: "column", alignItems: "start", gap: 1, children: [
      { type: "text", text: a.name || "国家电网", font: { size: "headline", weight: "semibold" }, textColor: WHITE, maxLines: 1 },
      { type: "text", text: mask(a.accountNumber), font: { size: "caption2", weight: "medium" }, textColor: MUTED, maxLines: 1 },
    ] },
    { type: "spacer" },
    { type: "stack", direction: "row", alignItems: "center", gap: 5, padding: [4, 8], borderRadius: 10, backgroundColor: GLASS, children: [
      statusDot(a.overdue),
      { type: "text", text: a.overdue ? "待缴费" : "正常", font: { size: "caption2", weight: "semibold" }, textColor: a.overdue ? DANGER : SUCCESS },
    ] },
  ] };
}

function metric(title, value, icon, color) {
  return { type: "stack", direction: "column", alignItems: "start", flex: 1, gap: 7, padding: [10, 9], borderRadius: 14, backgroundColor: GLASS, children: [
    { type: "stack", direction: "row", alignItems: "center", gap: 5, children: [
      { type: "image", src: icon, width: 11, height: 11, color: MUTED },
      { type: "text", text: title, font: { size: "caption2", weight: "medium" }, textColor: MUTED, maxLines: 1, minScale: 0.72 },
    ] },
    { type: "text", text: value, font: { size: "subheadline", weight: "semibold" }, textColor: color, maxLines: 1, minScale: 0.5 },
  ] };
}

function diagnosticSummary(diagnostic) {
  const events = Array.isArray(diagnostic?.trace?.events) ? diagnostic.trace.events : [];
  const latest = events[events.length - 1] || null;
  const status = String(diagnostic?.status?.message || "暂无诊断记录").slice(0, 52);
  const time = latest?.at ? diagnosticTime(latest.at) : "--:--";
  return { type: "stack", direction: "column", gap: 3, padding: [7, 9], borderRadius: 11, backgroundColor: GLASS, children: [
    { type: "stack", direction: "row", alignItems: "center", gap: 5, children: [
      { type: "image", src: "sf-symbol:stethoscope", width: 10, height: 10, color: MUTED },
      { type: "text", text: "最近诊断", font: { size: "caption2", weight: "semibold" }, textColor: MUTED, maxLines: 1 },
      { type: "spacer" },
      { type: "text", text: time, font: { size: "caption2", weight: "medium" }, textColor: MUTED, maxLines: 1 },
    ] },
    { type: "text", text: status, font: { size: "caption2", weight: "medium" }, textColor: diagnostic?.status?.kind === "error" ? DANGER : WHITE, maxLines: 1, minScale: 0.65 },
  ] };
}

function diagnosticTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function footer(a) {
  return { type: "stack", direction: "row", alignItems: "center", gap: 6, children: [
    { type: "image", src: "sf-symbol:clock", width: 10, height: 10, color: MUTED },
    { type: "text", text: updateLabel(a.updatedAt), font: { size: "caption2" }, textColor: MUTED, maxLines: 1 },
    { type: "spacer" },
    { type: "text", text: a.overdue ? "存在欠费" : "账户正常", font: { size: "caption2", weight: "medium" }, textColor: a.overdue ? DANGER : SUCCESS },
  ] };
}

function compactRow(label, value) {
  return { type: "stack", direction: "row", alignItems: "center", children: [
    { type: "text", text: label, font: { size: "caption2", weight: "medium" }, textColor: MUTED, maxLines: 1 },
    { type: "spacer" },
    { type: "text", text: value, font: { size: "caption2", weight: "semibold" }, textColor: WHITE, maxLines: 1, minScale: 0.62 },
  ] };
}

function symbolBadge(icon, size) {
  return { type: "stack", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: GLASS_STRONG, children: [
    { type: "image", src: icon, width: size, height: size, color: WHITE },
  ] };
}

function statusDot(overdue) {
  return { type: "stack", width: 6, height: 6, borderRadius: 3, backgroundColor: overdue ? DANGER : SUCCESS };
}

function recentDays(days) {
  const recent = (days || []).slice(-7);
  const max = Math.max(1, ...recent.map((x) => x.kwh || 0));
  return { type: "stack", direction: "column", gap: 6, padding: 10, borderRadius: 14, backgroundColor: GLASS, children: [
    { type: "text", text: "近 7 日用电", font: { size: "caption1", weight: "semibold" }, textColor: WHITE },
    { type: "stack", direction: "row", alignItems: "end", gap: 5, children: recent.map((x) => ({
      type: "stack", direction: "column", alignItems: "center", flex: 1, gap: 3, children: [
        { type: "text", text: format(x.kwh, 1), font: { size: "caption2", weight: "medium" }, textColor: MUTED, minScale: 0.5 },
        { type: "stack", width: 8, height: Math.max(4, Math.round(34 * x.kwh / max)), borderRadius: 4, backgroundColor: SUCCESS },
      ],
    })) },
  ] };
}

function emptyWidget(family, captureStatus, env, updateMode) {
  const compact = family.startsWith("accessory");
  const message = (!env.SGCC_USERNAME || !env.SGCC_PASSWORD)
    ? (compact ? "请配置国网账号" : "请在模块设置中填写网上国网账号和密码")
    : (!updateMode && !captureStatus)
      ? (compact ? "请先更新数据" : "请运行“国家电网·立即更新”更新数据")
      : captureStatusMessage(captureStatus, compact);
  return { type: "widget", padding: compact ? 5 : 16, gap: 7, backgroundGradient: BACKGROUND, children: [
    compact ? { type: "image", src: "sf-symbol:bolt.fill", width: 16, height: 16, color: WHITE } : symbolBadge("sf-symbol:bolt.fill", 15),
    { type: "text", text: `国家电网 · v${VERSION}`, font: { size: compact ? "caption1" : "headline", weight: "bold" }, textColor: WHITE },
    { type: "text", text: message, font: { size: "caption1" }, textColor: MUTED, maxLines: compact ? 1 : 3 },
    ...(compact ? [] : [{ type: "text", text: "手动更新：小组件画廊 → 国家电网·立即更新", font: { size: "caption2" }, textColor: MUTED, maxLines: 2 }]),
  ] };
}

function fatalWidget(family) {
  const compact = String(family || "").startsWith("accessory");
  return {
    type: "widget", padding: compact ? 5 : 14, gap: 6, backgroundColor: "#8B1E1E",
    children: [
      { type: "text", text: `国家电网 · v${VERSION}`, font: { size: "headline", weight: "bold" }, textColor: WHITE, maxLines: 1 },
      { type: "text", text: compact ? "运行错误" : "运行错误，请打开国家电网·诊断查看安全诊断信息", font: { size: "caption1" }, textColor: WHITE, maxLines: compact ? 1 : 4 },
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
