import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadWidgetInternals(now = '2026-07-13T12:00:00+08:00', timerApi = {}) {
  let source = fs.readFileSync(new URL('../state-grid-widget.js', import.meta.url), 'utf8');
  source = source.replace('export default async function (ctx)', 'async function widgetMain(ctx)');
  source += '\n;globalThis.__testExports = { widgetMain, normalizeAccount, previousMonthRecord, providerError, safeHost, safeProviderPayload, runLegacyProvider, legacyHttpClient };';

  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  };
  const sandbox = {
    console,
    Date: FixedDate,
    setTimeout: timerApi.setTimeout || setTimeout,
    clearTimeout: timerApi.clearTimeout || clearTimeout,
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
  assert.match(JSON.stringify(result), /查询完成，但没有返回户号数据|尚未完成首次查询|等待账户数据/);
}

function testDiagnosticsRedactSecretsAndUrlDetails() {
  const { providerError, safeHost } = loadWidgetInternals();
  const username = '13800138000';
  const password = 'P@ssword-123';
  const message = providerError(
    new Error(`Bearer abc.def token=secret ${username} ${password} https://user:pass@example.com/private?token=hidden`),
    { SGCC_USERNAME: username, SGCC_PASSWORD: password },
  );
  assert.equal(message, '查询服务返回异常，请查看诊断步骤');
  assert.equal(safeHost('https://user:pass@example.com/private?token=hidden'), '其他查询服务');
  assert.equal(safeHost('https://user:pass@api.120399.xyz/private?token=hidden'), 'api.120399.xyz');
}

function testProviderErrorPreservesSafeCategoryWhenRawMessageContainsUrl() {
  const { providerError } = loadWidgetInternals();
  const risk = new Error('账号触发登录风控，请次日再次尝试。请登录 https://www.95598.cn/ 手动确认账号密码');
  assert.equal(providerError(risk), '国网限制登录频率，请明天再试');
  assert.equal(providerError(new Error('解密响应失败：https://api.120399.xyz')), '查询服务响应解析失败，请稍后重试');
  assert.equal(providerError(new Error('查询脚本返回的数据无法解析')), '查询服务响应解析失败，请稍后重试');
}

function testSafeProviderPayloadClassifiesSmallJsonErrorsWithoutLeakingBody() {
  const { safeProviderPayload } = loadWidgetInternals();
  assert.equal(safeProviderPayload('{"code":-100,"message":"操作过于频繁"}'), '国网限制登录频率，请明天再试');
  assert.equal(safeProviderPayload('{"code":"RK008","message":"blockPuzzle"}'), '国网登录验证未通过，请稍后重试');
  assert.equal(safeProviderPayload('{"code":10002,"message":"Token 为空！"}'), '国网登录状态已失效，请重新查询');
  assert.equal(safeProviderPayload('{"code":500,"message":"解密响应失败"}'), '查询服务响应解析失败，请稍后重试');
  assert.equal(safeProviderPayload('{"token":"secret","message":"private"}'), '');
  assert.equal(safeProviderPayload('not json'), '');
}

async function testSmallProviderErrorResponseAddsSafeDiagnosticCategory() {
  const { legacyHttpClient } = loadWidgetInternals();
  const values = new Map();
  const body = '{"code":10002,"message":"Token 为空！"}';
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
    },
    http: {
      post: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: async () => body }),
    },
  };
  await new Promise((resolve, reject) => legacyHttpClient(ctx).post('https://api.120399.xyz/private', (error) => error ? reject(error) : resolve()));
  const serialized = JSON.stringify(values.get('state_grid_diagnostic_v1'));
  assert.match(serialized, /登录状态已失效/);
  assert.doesNotMatch(serialized, /Token|10002|private/);
}

async function testProviderStorageRejectsCredentialValues() {
  const { runLegacyProvider } = loadWidgetInternals();
  const values = new Map();
  const username = '13800138000';
  const password = 'P@ssword-123';
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
    http: {},
  };
  const source = `$persistentStore.write($argument.username, 'leaked_user');
    $persistentStore.write($argument.password, 'leaked_password');
    $notification.post('错误', '', 'Bearer hidden-token https://example.com/private?token=x');
    $done({});`;
  await assert.rejects(() => runLegacyProvider(ctx, source, { SGCC_USERNAME: username, SGCC_PASSWORD: password }), /查询服务返回异常/);
  const serialized = JSON.stringify([...values.entries()]);
  assert.doesNotMatch(serialized, new RegExp(username));
  assert.doesNotMatch(serialized, /P@ssword-123|hidden-token|private|token=x/);
}

async function testNetworkFailurePersistsOnlySafeHostAndCategory() {
  const { legacyHttpClient } = loadWidgetInternals();
  const values = new Map();
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
    },
    http: { get: async () => { throw new Error('Bearer hidden https://example.com/private?token=x'); } },
  };
  await new Promise((resolve) => {
    legacyHttpClient(ctx).get('https://user:pass@api.120399.xyz/private?token=x', () => resolve());
  });
  const serialized = JSON.stringify(values.get('state_grid_diagnostic_v1'));
  assert.match(serialized, /api\.120399\.xyz/);
  assert.doesNotMatch(serialized, /user:pass|private|token=x|Bearer hidden/);
}

async function testZeroResultReplacesStaleSuccessStatus() {
  const { widgetMain } = loadWidgetInternals();
  const values = new Map([
    ['state_grid_capture_status_v2', { kind: 'success', message: '旧查询成功' }],
    ['state_grid_provider_source_v1', '$done({response:{body:"[]"}});/*' + 'x'.repeat(50001) + '*/'],
  ]);
  await widgetMain({
    widgetFamily: 'systemMedium',
    env: { RUN_MODE: 'update', SGCC_USERNAME: 'tester', SGCC_PASSWORD: 'secret' },
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
  });
  assert.equal(values.get('state_grid_capture_status_v2').kind, 'empty');
  assert.doesNotMatch(JSON.stringify(values.get('state_grid_capture_status_v2')), /旧查询成功/);
}

async function testTimeoutPersistsActiveSafeHost() {
  const { runLegacyProvider } = loadWidgetInternals(
    '2026-07-13T12:00:00+08:00',
    { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout },
  );
  const values = new Map();
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
    http: { get: () => new Promise(() => {}) },
  };
  const source = `$httpClient.get('https://user:pass@api.120399.xyz/private?token=x', function () {});`;
  await assert.rejects(
    () => runLegacyProvider(ctx, source, { SGCC_USERNAME: 'tester', SGCC_PASSWORD: 'secret' }),
    /查询超时/,
  );
  const serialized = JSON.stringify(values.get('state_grid_diagnostic_v1'));
  assert.match(serialized, /查询超时：停在 api\.120399\.xyz/);
  assert.doesNotMatch(serialized, /user:pass|private|token=x|tester|secret/);
}

async function testSuccessfulResponseRecordsOnlyTypeAndSize() {
  const { legacyHttpClient } = loadWidgetInternals();
  const values = new Map();
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
    },
    http: {
      post: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: async () => '{"private":"must-not-appear"}',
      }),
    },
  };
  await new Promise((resolve, reject) => {
    legacyHttpClient(ctx).post('https://api.120399.xyz/secret-path', (error) => error ? reject(error) : resolve());
  });
  const serialized = JSON.stringify(values.get('state_grid_diagnostic_v1'));
  assert.match(serialized, /#1 api\.120399\.xyz → HTTP 200 · JSON · 29B/);
  assert.doesNotMatch(serialized, /secret-path|must-not-appear|private/);
}

function testReleaseVersionIsConsistent() {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = packageJson.version;
  for (const file of ['state-grid-widget.js', 'state-grid-health.js', 'state-grid.yaml', 'README.md']) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, new RegExp(version.replace(/\./g, '\\.'), 'g'), `${file} should reference ${version}`);
    assert.doesNotMatch(text, /v=1\.5\.0|v1\.5\.0/, `${file} should not contain stale v1.5.0 references`);
  }
}

function testTestReleaseLoadsScriptsFromTestBranch() {
  const yaml = fs.readFileSync(new URL('../state-grid.yaml', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(yaml, /refs\/heads\/test\/state-grid-widget\.js/);
  assert.match(yaml, /refs\/heads\/test\/state-grid-health\.js/);
  assert.doesNotMatch(yaml, /refs\/heads\/main\/state-grid-(widget|health)\.js/);
  assert.match(readme, /refs\/heads\/test\/state-grid\.yaml/);
}

async function testUpdaterGalleryActionRemainsAvailableForManualRefresh() {
  const yaml = fs.readFileSync(new URL('../state-grid.yaml', import.meta.url), 'utf8');
  const widgets = yaml.slice(yaml.indexOf('\nwidgets:'));
  assert.match(widgets, /name: "国家电网·更新数据"\s+script_name: "state-grid-updater"/);
  assert.match(yaml, /name: "state-grid-auto-update"/);
}

async function testDiagnosticWidgetUsesGlassLayoutAndReadableEvents() {
  let source = fs.readFileSync(new URL('../state-grid-health.js', import.meta.url), 'utf8');
  source = source.replace('export default async function (ctx)', 'async function healthMain(ctx)');
  source += '\n;globalThis.__healthMain = healthMain;';
  const sandbox = { Date };
  vm.runInNewContext(source, sandbox, { filename: 'state-grid-health.js' });
  const values = new Map([
    ['state_grid_capture_status_v2', { kind: 'error', message: '查询服务超时，请稍后重试' }],
    ['state_grid_diagnostic_v1', { events: [
      { at: '2026-07-14T13:49:26+08:00', message: '#1 请求 api.120399.xyz' },
      { at: '2026-07-14T13:49:30+08:00', message: '#1 api.120399.xyz → HTTP 200 · JSON · 969B' },
      { at: '2026-07-14T13:49:42+08:00', message: '查询超时：停在 www.95598.cn' },
    ] }],
  ]);
  const widget = await sandbox.__healthMain({ storage: { getJSON: (key) => values.get(key) || null } });
  const serialized = JSON.stringify(widget);
  assert.equal(JSON.stringify(widget.backgroundGradient.colors), JSON.stringify(['#16213A', '#0B7285', '#25A18E']));
  assert.match(serialized, /#FFFFFF1A/);
  assert.match(serialized, /查询超时：停在 www\.95598\.cn/);
  assert.match(serialized, /查询服务超时，请稍后重试/);
  assert.doesNotMatch(serialized, /backgroundColor":"#245A4A/);
}

async function testTimeoutWatchdogUsesShortTicksForEgern() {
  const delays = [];
  const { runLegacyProvider } = loadWidgetInternals(
    '2026-07-13T12:00:00+08:00',
    { setTimeout: (fn, delay) => { delays.push(delay); return setTimeout(fn, 0); }, clearTimeout },
  );
  const ctx = {
    storage: { getJSON: () => null, setJSON: () => {}, get: () => null, set: () => {}, delete: () => {} },
    http: {},
  };
  await assert.rejects(
    () => runLegacyProvider(ctx, '', { SGCC_USERNAME: 'tester', SGCC_PASSWORD: 'secret' }),
    /查询超时/,
  );
  assert.ok(delays.length >= 8, 'watchdog should accumulate timeout over multiple short ticks');
  assert.ok(delays.every((delay) => delay <= 10000), `Egern-safe timer ticks expected, got ${delays.join(',')}`);
}

async function testLateHttpResponseAfterTimeoutDoesNotAppendDiagnostics() {
  const { runLegacyProvider } = loadWidgetInternals(
    '2026-07-13T12:00:00+08:00',
    { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout },
  );
  const values = new Map();
  let resolveRequest;
  const ctx = {
    storage: {
      getJSON: (key) => values.get(key) || null,
      setJSON: (key, value) => values.set(key, value),
      get: (key) => values.get(key) || null,
      set: (key, value) => values.set(key, value),
      delete: (key) => values.delete(key),
    },
    http: { get: () => new Promise((resolve) => { resolveRequest = resolve; }) },
  };
  const source = `$httpClient.get('https://www.95598.cn/private', function () {});`;
  await assert.rejects(
    () => runLegacyProvider(ctx, source, { SGCC_USERNAME: 'tester', SGCC_PASSWORD: 'secret' }),
    /查询超时/,
  );
  resolveRequest({ status: 200, headers: { 'content-type': 'application/json' }, text: async () => '{"late":true}' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const serialized = JSON.stringify(values.get('state_grid_diagnostic_v1'));
  assert.match(serialized, /查询超时：停在 www\.95598\.cn/);
  assert.doesNotMatch(serialized, /HTTP 200/);
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

async function testWidgetsUseMinimalGlassDesignSystem() {
  const medium = await renderManualWidget('systemMedium');
  const small = await renderManualWidget('systemSmall');
  const mediumText = JSON.stringify(medium);
  const smallText = JSON.stringify(small);

  assert.equal(JSON.stringify(medium.backgroundGradient.colors), JSON.stringify(['#16213A', '#0B7285', '#25A18E']));
  assert.equal(JSON.stringify(small.backgroundGradient.colors), JSON.stringify(['#16213A', '#0B7285', '#25A18E']));
  assert.match(mediumText, /#FFFFFF1A/);
  assert.match(mediumText, /#FFFFFF2E/);
  assert.match(mediumText, /账户正常/);
  assert.match(smallText, /本月用电/);
  assert.match(smallText, /上月账单/);
  assert.doesNotMatch(mediumText, /#00796B|#00A88F/);
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
testDiagnosticsRedactSecretsAndUrlDetails();
testProviderErrorPreservesSafeCategoryWhenRawMessageContainsUrl();
testSafeProviderPayloadClassifiesSmallJsonErrorsWithoutLeakingBody();
await testSmallProviderErrorResponseAddsSafeDiagnosticCategory();
await testProviderStorageRejectsCredentialValues();
await testNetworkFailurePersistsOnlySafeHostAndCategory();
await testZeroResultReplacesStaleSuccessStatus();
await testTimeoutPersistsActiveSafeHost();
await testSuccessfulResponseRecordsOnlyTypeAndSize();
await testTimeoutWatchdogUsesShortTicksForEgern();
await testLateHttpResponseAfterTimeoutDoesNotAppendDiagnostics();
testReleaseVersionIsConsistent();
testTestReleaseLoadsScriptsFromTestBranch();
await testUpdaterGalleryActionRemainsAvailableForManualRefresh();
await testDiagnosticWidgetUsesGlassLayoutAndReadableEvents();
await testWidgetsUseMinimalGlassDesignSystem();
await testMediumWidgetRendersAllRequestedMetrics();
await testLockScreenWidgetsIncludePreviousBill();
console.log('widget tests passed');
