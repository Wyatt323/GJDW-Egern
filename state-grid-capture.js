const STORAGE_KEY = "state_grid_widget_v1";

export default async function (ctx) {
  let body = "";
  try {
    let requestAccount = "";
    try {
      const requestPayload = await ctx.request?.json();
      requestAccount = findAccountNumber(requestPayload);
    } catch (_) {
      // Some GET requests have no JSON body; the response can still be harvested.
    }
    body = await ctx.response.text();
    if (!body || !/^[\s]*[\[{]/.test(body)) return { body };
    const payload = JSON.parse(body);
    const fragments = collectFragments(payload);
    if (!fragments.length) return { body };

    const saved = ctx.storage.getJSON(STORAGE_KEY) || { accounts: [] };
    const accounts = Array.isArray(saved.accounts) ? saved.accounts : [];
    for (const fragment of fragments) mergeFragment(accounts, fragment, requestAccount);
    ctx.storage.setJSON(STORAGE_KEY, {
      accounts: accounts.slice(0, 10),
      updatedAt: new Date().toISOString(),
      source: "网上国网本地响应",
    });
    console.log(`[国家电网] 已更新 ${accounts.length} 个户号的小组件缓存`);
  } catch (error) {
    console.log(`[国家电网] 响应采集跳过: ${String(error)}`);
  }
  return { body };
}

function collectFragments(root) {
  const queue = [root];
  const seen = new Set();
  const result = [];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.some((key) => [
      "consNo_dst", "consName_dst", "sumMoney", "accountBalance", "historyOwe",
      "sevenEleList", "mothEleList", "totalEleNum", "totalEleCost",
    ].includes(key))) result.push(fragmentFrom(value));
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return result.filter(Boolean);
}

function fragmentFrom(value) {
  if (value.consNo_dst || value.consName_dst) return {
    accountNumber: text(value.consNo_dst || value.consNo), name: text(value.consName_dst || value.consName), address: text(value.eleAddress || value.address),
  };
  if (value.sumMoney != null || value.accountBalance != null || value.historyOwe != null) return {
    accountNumber: text(value.consNo), balance: number(value.accountBalance ?? value.sumMoney), overdue: number(value.historyOwe) > 0 || number(value.sumMoney) < 0, updatedAt: text(value.date || new Date().toISOString()),
  };
  if (Array.isArray(value.sevenEleList)) {
    const days = value.sevenEleList.map((row) => ({ day: text(row.day || row.date), kwh: number(row.dayElePq ?? row.power) })).filter((x) => x.kwh != null);
    return { days, latestDay: days.at(-1)?.day || "", latestKwh: days.at(-1)?.kwh ?? null, monthKwh: sumCurrentMonth(days), updatedAt: new Date().toISOString() };
  }
  if (Array.isArray(value.mothEleList)) {
    const months = value.mothEleList.map((row) => ({ month: text(row.month), kwh: number(row.monthEleNum), fee: number(row.monthEleCost) }));
    const latest = months.filter((x) => x.kwh != null || x.fee != null).at(-1) || {};
    return { monthKwh: latest.kwh, monthFee: latest.fee, yearKwh: number(value.dataInfo?.totalEleNum), yearFee: number(value.dataInfo?.totalEleCost), updatedAt: new Date().toISOString() };
  }
  if (value.totalEleNum != null || value.totalEleCost != null) return { yearKwh: number(value.totalEleNum), yearFee: number(value.totalEleCost), updatedAt: new Date().toISOString() };
  return null;
}

function mergeFragment(accounts, fragment, requestAccount) {
  const accountNumber = fragment.accountNumber || requestAccount;
  let target = accountNumber
    ? accounts.find((x) => x.accountNumber === accountNumber) || accounts.find((x) => !x.accountNumber)
    : accounts[0];
  if (!target) { target = { accountNumber: accountNumber || "", name: "国家电网", days: [] }; accounts.push(target); }
  if (accountNumber) target.accountNumber = accountNumber;
  for (const [key, value] of Object.entries(fragment)) if (value != null && value !== "") target[key] = value;
}

function findAccountNumber(root) {
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const account = value.consNo_dst || value.consNoSrc || value.consNo;
    if (account) return text(account);
    for (const child of Object.values(value)) if (child && typeof child === "object") queue.push(child);
  }
  return "";
}

function sumCurrentMonth(days) {
  const now = new Date();
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const matched = days.filter((x) => text(x.day).replace(/\D/g, "").startsWith(prefix));
  return matched.length ? matched.reduce((sum, x) => sum + (x.kwh || 0), 0) : null;
}
function number(value) { if (value == null || value === "" || value === "-") return null; const n = Number(String(value).replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function text(value) { return value == null ? "" : String(value); }
