import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../StateGrid.js', import.meta.url), 'utf8');

function loadCore(now = '2026-07-14T12:00:00+08:00') {
  const transformed = source
    .replace('if (!IS_NODE_TEST) await main();', '')
    .replace(/^const IS_NODE_TEST[^;]*;/m, 'const IS_NODE_TEST = true;');
  const sandbox = { console, Date: class extends Date { constructor(v) { super(v ?? now); } static now() { return new Date(now).getTime(); } }, globalThis: {} };
  vm.runInNewContext(`${transformed}\nglobalThis.__core={normalizeAccounts,previousMonthRecord,buildDeepLink,safeDiagnostic,safeProviderPayload,selectAccount,parseProviderResult};`, sandbox, { filename: 'StateGrid.js' });
  return sandbox.globalThis.__core;
}

function testPreviousMonthSelectionAcrossYearBoundary() {
  const { previousMonthRecord } = loadCore('2026-01-15T12:00:00+08:00');
  const row = previousMonthRecord([{ month: '202601', fee: 20 }, { month: '202512', fee: 88 }]);
  assert.equal(row.month, '202512');
  assert.equal(row.fee, 88);
}

function testNormalizesManualAndProviderAccounts() {
  const { normalizeAccounts } = loadCore();
  const rows = normalizeAccounts([{ consNo: '123456', consName: '家里', balance: '18.2', monthKwh: '32.5', previousMonthFee: '66.8' }]);
  assert.equal(rows[0].accountNumber, '123456');
  assert.equal(rows[0].balance, 18.2);
  assert.equal(rows[0].monthKwh, 32.5);
  assert.equal(rows[0].previousMonthFee, 66.8);
}

function testDeepLinksEncodeActionsAndParameters() {
  const { buildDeepLink } = loadCore();
  const url = buildDeepLink('refresh', { account: 1 });
  assert.match(url, /^scriptable:\/\/\/run\?/);
  assert.match(url, /scriptName=StateGrid/);
  assert.match(url, /action=refresh/);
  assert.match(url, /account=1/);
}

function testSafeProviderErrorsAreClassifiedWithoutLeakingPayload() {
  const { safeProviderPayload } = loadCore();
  assert.equal(safeProviderPayload({ code: '-10009', message: '操作频繁，请次日再次尝试' }), '国网限制登录频率，请明天再试');
  assert.equal(safeProviderPayload({ errorCode: 'RK1003', message: '需要验证码' }), '国网登录验证未通过');
  assert.equal(safeProviderPayload({ code: 200, data: [{ consNo: '1' }] }), '');
}

function testDiagnosticsAreAllowlisted() {
  const { safeDiagnostic } = loadCore();
  assert.equal(safeDiagnostic(new Error('password=secret https://host/private')), '查询服务返回异常');
  assert.equal(safeDiagnostic(new Error('操作频繁，请次日再次尝试')), '国网限制登录频率，请明天再试');
}

function testSelectAccountUsesConfiguredIndex() {
  const { selectAccount } = loadCore();
  assert.equal(selectAccount([{ name: 'A' }, { name: 'B' }], { accountIndex: 1 }).name, 'B');
  assert.equal(selectAccount([{ name: 'A' }], { accountIndex: 9 }).name, 'A');
}

function testParsesEgernDoneEnvelope() {
  const { parseProviderResult } = loadCore();
  assert.equal(JSON.stringify(parseProviderResult({ response: { body: '{"data":[{"consNo":"1"}]}' } })), '{"data":[{"consNo":"1"}]}');
}

function testNormalizesActualProviderShapeAndSumsCurrentMonth() {
  const { normalizeAccounts } = loadCore();
  const rows = normalizeAccounts([{
    userInfo: { consNo_dst: '123', consName_dst: '家里' },
    eleBill: { accountBalance: '128.30' },
    dayElecQuantity31: { sevenEleList: [
      { day: '20260701', dayElePq: '1.2' },
      { day: '20260702', dayElePq: '2.3' },
    ] },
    monthElecQuantity: { mothEleList: [{ month: '202606', monthEleNum: '70', monthEleCost: '35.00' }] },
  }]);
  assert.equal(rows[0].balance, 128.3);
  assert.equal(rows[0].monthKwh, 3.5);
  assert.equal(rows[0].previousMonthFee, 35);
}

function testControlPanelActionsDoNotDismissBeforeAsyncWorkFinishes() {
  assert.match(source, /row\.dismissOnSelect\s*=\s*false/);
  assert.match(source, /await table\.present\(\)/);
}

function testScriptableWatchdogUsesMilliseconds() {
  assert.match(source, /Timer\.schedule\(85000, false/);
}

function testProviderHttpClientTracksSafeRequestSteps() {
  assert.match(source, /saveDiagnostic\("pending", `#\$\{requestId\} 请求 \$\{host\}`\)/);
  assert.match(source, /saveDiagnostic\("pending", `#\$\{requestId\} \$\{host\} → HTTP \$\{status\}`\)/);
  assert.match(source, /safeHost\(input\.url\)/);
}

function testProviderRunsInEgernCompatibilityModeWithExpectedArgument() {
  assert.match(source, /globalThis\.Egern\s*=\s*globalThis\.Egern/);
  assert.match(source, /globalThis\.\$request\s*=\s*\{ method: "GET", url: "https:\/\/api\.wsgw-rewrite\.com\/electricity\/bill\/all" \}/);
  assert.match(source, /username: settings\.username/);
  assert.match(source, /password: settings\.password/);
  assert.match(source, /service: "true"/);
}

function testSensitiveProviderSessionUsesKeychainWhileCachesUseLocalFiles() {
  assert.match(source, /FileManager\.local\(\)/);
  assert.doesNotMatch(source, /Keychain\.set\(KEYS\.cache/);
  assert.match(source, /Keychain\.set\(KEYS\.settings/);
  assert.match(source, /Keychain\.set\(KEYS\.providerState/);
  assert.doesNotMatch(source, /FILES\.providerState/);
}

testPreviousMonthSelectionAcrossYearBoundary();
testNormalizesManualAndProviderAccounts();
testDeepLinksEncodeActionsAndParameters();
testSafeProviderErrorsAreClassifiedWithoutLeakingPayload();
testDiagnosticsAreAllowlisted();
testSelectAccountUsesConfiguredIndex();
testParsesEgernDoneEnvelope();
testNormalizesActualProviderShapeAndSumsCurrentMonth();
testControlPanelActionsDoNotDismissBeforeAsyncWorkFinishes();
testScriptableWatchdogUsesMilliseconds();
testProviderHttpClientTracksSafeRequestSteps();
testProviderRunsInEgernCompatibilityModeWithExpectedArgument();
testSensitiveProviderSessionUsesKeychainWhileCachesUseLocalFiles();
console.log('scriptable core tests passed');
