// Deprecated since v1.4.0. Kept only so stale module installations fail safely.
// Active account/password queries run through state-grid-widget.js.
export default async function (ctx) {
  let body = "";
  try { body = await ctx.response.text(); }
  catch (_) { /* preserve an empty response body when unavailable */ }
  console.log("[国家电网] 旧版响应采集器已停用，请重新导入最新版模块");
  return { body };
}
