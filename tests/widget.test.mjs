import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadWidgetInternals(now = '2026-07-13T12:00:00+08:00') {
  let source = fs.readFileSync(new URL('../state-grid-widget.js', import.meta.url), 'utf8');
  source = source.replace('export default async function (ctx)', 'async function widgetMain(ctx)');
  source += '\n;globalThis.__testExports = { widgetMain, normalizeAccount, previousMonthRecord };';

  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  };
  const sandbox = {
    console,
    Date: FixedDate,
    setTimeout,
    clearTimeout,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'state-grid-widget.js' });
  return sandbox.__testExports;
}

function testPreviousCalendarMonthIsSelectedFromUnsortedRows() {
  const { previousMonthRecord } = loadWidgetInternals();
  const rows = [
    { month: '2026-07', kwh: 9, fee: 4.5 },
    { month: '2025-12', kwh: 100, fee: 50 },
    { month: '202606', kwh: 88.6, fee: 47.25 },
    { month: '2026-05', kwh: 70, fee: 35 },
  ];
  const bill = previousMonthRecord(rows, new Date('2026-07-13T12:00:00+08:00'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(bill)),
    { month: '2026-06', kwh: 88.6, fee: 47.25 },
  );
}

function testJanuaryUsesPreviousDecember() {
  const { previousMonthRecord } = loadWidgetInternals('2026-01-05T12:00:00+08:00');
  const bill = previousMonthRecord([
    { month: '2025年12月', kwh: 120, fee: 66.2 },
    { month: '2026年01月', kwh: 5, fee: 2.4 },
  ], new Date('2026-01-05T12:00:00+08:00'));
  assert.equal(bill.month, '2025-12');
  assert.equal(bill.fee, 66.2);
}

function testNormalizedAccountExposesPreviousMonthBill() {
  const { normalizeAccount } = loadWidgetInternals();
  const account = normalizeAccount({
    userInfo: { consNo_dst: '1234567890123', consName_dst: '家里' },
    eleBill: { accountBalance: '128.30' },
    dayElecQuantity31: {
      sevenEleList: [
        { day: '20260701', dayElePq: '1.2' },
        { day: '20260702', dayElePq: '2.3' },
      ],
    },
    monthElecQuantity: {
      mothEleList: [
        { month: '202605', monthEleNum: '70.0', monthEleCost: '35.00' },
        { month: '202606', monthEleNum: '88.6', monthEleCost: '47.25' },
      ],
    },
  });
  assert.equal(account.balance, 128.3);
  assert.equal(account.monthKwh, 3.5);
  assert.equal(account.previousMonth, '2026-06');
  assert.equal(account.previousMonthKwh, 88.6);
  assert.equal(account.previousMonthFee, 47.25);
}

function testJanuaryProviderPayloadUsesLastYearDecember() {
  const { normalizeAccount } = loadWidgetInternals('2026-01-05T12:00:00+08:00');
  const account = normalizeAccount({
    userInfo: { consNo_dst: '1234567890123', consName_dst: '家里' },
    eleBill: { accountBalance: '88.00' },
    dayElecQuantity31: { totalPq: '45.0', sevenEleList: [] },
    monthElecQuantity: {
      mothEleList: [{ month: '202601', monthEleNum: '5.0', monthEleCost: '2.50' }],
    },
    lastYearElecQuantity: {
      mothEleList: [{ month: '202512', monthEleNum: '120', monthEleCost: '66.20' }],
    },
  });
  assert.equal(account.monthKwh, 45);
  assert.equal(account.previousMonth, '2025-12');
  assert.equal(account.previousMonthKwh, 120);
  assert.equal(account.previousMonthFee, 66.2);
}

function testFlatProviderPayloadIsNormalized() {
  const { normalizeAccount } = loadWidgetInternals();
  const account = normalizeAccount({
    consNo: '1234567890123',
    consName: '家里',
    balance: '128.30',
    isOwe: false,
    currentUsage: '42.8',
    previousMonthUsage: '88.6',
    previousMonthCost: '47.25',
  });
  assert.equal(account.accountNumber, '1234567890123');
  assert.equal(account.balance, 128.3);
  assert.equal(account.monthKwh, 42.8);
  assert.equal(account.previousMonth, '2026-06');
  assert.equal(account.previousMonthKwh, 88.6);
  assert.equal(account.previousMonthFee, 47.25);
}

function testLegacyMonthFeeIsNotRelabeledAsPreviousBill() {
  const { normalizeAccount } = loadWidgetInternals();
  const account = normalizeAccount({
    accountNumber: '1234567890123',
    balance: 10,
    monthKwh: 20,
    monthFee: 30,
  });
  assert.equal(account.previousMonthFee, null);
}

async function testStaleV1SuccessStatusDoesNotClaimV2DataWasUpdated() {
  const { widgetMain } = loadWidgetInternals();
  const values = new Map([
    ['state_grid_capture_status_v1', {
      kind: 'success',
      hitAt: '2026-07-12T12:00:00+08:00',
      message: '网上国网数据已更新',
    }],
  ]);
  const result = await widgetMain({
    widgetFamily: 'systemMedium',
    env: { SGCC_USERNAME: 'tester', SGCC_PASSWORD: 'secret' },
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
  });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /运行.*更新数据|等待账户数据/);
  assert.doesNotMatch(serialized, /网上国网数据已更新|已更新/);
}

async function testUpdaterPersistsAVisibleTimeoutDiagnostic() {
  const { widgetMain } = loadWidgetInternals();
  const values = new Map();
  const result = await widgetMain({
    widgetFamily: 'systemMedium',
    env: {
      RUN_MODE: 'update',
      SGCC_USERNAME: 'tester',
      SGCC_PASSWORD: 'secret',
    },
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => key === 'state_grid_provider_source_v1'
        ? '$done({response:{body:"[]"}});/*' + 'x'.repeat(50001) + '*/'
        : values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
    http: {
      post: async () => { throw new Error('network unreachable'); },
      get: async () => { throw new Error('network unreachable'); },
      put: async () => { throw new Error('network unreachable'); },
      delete: async () => { throw new Error('network unreachable'); },
      patch: async () => { throw new Error('network unreachable'); },
      head: async () => { throw new Error('network unreachable'); },
      options: async () => { throw new Error('network unreachable'); },
    },
  });
  const trace = values.get('state_grid_diagnostic_v1');
  assert.ok(trace, 'updater should persist a diagnostic trace');
  assert.match(JSON.stringify(trace), /开始查询|查询引擎/);
  assert.doesNotMatch(JSON.stringify(trace), /secret|tester/);
  assert.match(JSON.stringify(result), /尚未完成首次查询|等待账户数据|运行.*更新数据/);
}

async function renderManualWidget(family) {
  const { widgetMain } = loadWidgetInternals();
  const values = new Map();
  return widgetMain({
    widgetFamily: family,
    env: {
      ACCOUNT: '1234567890123',
      BALANCE: '128.30',
      MONTH_KWH: '42.8',
      LAST_MONTH_BILL: '47.25',
    },
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
  });
}

async function testMediumWidgetRendersAllRequestedMetrics() {
  const result = await renderManualWidget('systemMedium');
  const serialized = JSON.stringify(result);
  assert.match(serialized, /电费余额/);
  assert.match(serialized, /本月用电/);
  assert.match(serialized, /上月账单/);
  assert.match(serialized, /¥128\.30/);
  assert.match(serialized, /42\.80 kWh/);
  assert.match(serialized, /¥47\.25/);
}

async function testLockScreenWidgetsIncludePreviousBill() {
  for (const family of ['accessoryInline', 'accessoryRectangular']) {
    const serialized = JSON.stringify(await renderManualWidget(family));
    assert.match(serialized, /47\.25/, `${family} should include the previous bill`);
  }
}

testPreviousCalendarMonthIsSelectedFromUnsortedRows();
testJanuaryUsesPreviousDecember();
testNormalizedAccountExposesPreviousMonthBill();
testJanuaryProviderPayloadUsesLastYearDecember();
testFlatProviderPayloadIsNormalized();
testLegacyMonthFeeIsNotRelabeledAsPreviousBill();
await testStaleV1SuccessStatusDoesNotClaimV2DataWasUpdated();
await testUpdaterPersistsAVisibleTimeoutDiagnostic();
await testMediumWidgetRendersAllRequestedMetrics();
await testLockScreenWidgetsIncludePreviousBill();
console.log('widget tests passed');
