const VERSION = "1.6.1";
const DIAGNOSTIC_KEY = "state_grid_diagnostic_v1";
const STATUS_KEY = "state_grid_capture_status_v2";
const INK = "#16213A";
const TEAL = "#0B7285";
const MINT = "#25A18E";
const WHITE = "#FFFFFF";
const MUTED = "#FFFFFFB8";
const GLASS = "#FFFFFF1A";
const GLASS_STRONG = "#FFFFFF2E";
const SUCCESS = "#BFFFE7";
const DANGER = "#FFD4D1";
const BACKGROUND = { type: "linear", colors: [INK, TEAL, MINT], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };

export default async function (ctx) {
  const trace = ctx.storage.getJSON(DIAGNOSTIC_KEY) || null;
  const status = ctx.storage.getJSON(STATUS_KEY) || null;
  const events = Array.isArray(trace?.events) ? trace.events.slice(-5) : [];
  const lines = events.length
    ? events.map((event) => `${timeLabel(event.at)}  ${event.message}`).join("\n")
    : "暂无诊断记录\n请等待自动更新后再查看";
  const isError = status?.kind === "error";

  return {
    type: "widget",
    padding: 15,
    gap: 8,
    backgroundGradient: BACKGROUND,
    refreshAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    children: [
      {
        type: "stack", direction: "row", alignItems: "center", gap: 8, children: [
          {
            type: "stack", width: 28, height: 28, alignItems: "center", justifyContent: "center",
            borderRadius: 9, backgroundColor: GLASS_STRONG,
            children: [{ type: "image", src: "sf-symbol:stethoscope", width: 14, height: 14, color: WHITE }],
          },
          { type: "text", text: "查询诊断", font: { size: "headline", weight: "semibold" }, textColor: WHITE, maxLines: 1 },
          { type: "spacer" },
          { type: "text", text: `v${VERSION}`, font: { size: "caption2", weight: "medium" }, textColor: MUTED, maxLines: 1 },
        ],
      },
      {
        type: "stack", direction: "row", alignItems: "center", gap: 7,
        padding: [7, 9], borderRadius: 11, backgroundColor: GLASS,
        children: [
          { type: "stack", width: 6, height: 6, borderRadius: 3, backgroundColor: isError ? DANGER : SUCCESS },
          {
            type: "text", text: status?.message || "等待下一次自动更新",
            font: { size: "caption1", weight: "semibold" }, textColor: isError ? DANGER : SUCCESS,
            maxLines: 2, minScale: 0.68,
          },
        ],
      },
      {
        type: "stack", direction: "column", gap: 4,
        padding: [8, 9], borderRadius: 11, backgroundColor: GLASS,
        children: [{
          type: "text", text: lines, font: { size: "caption2" }, textColor: "#FFFFFFCC",
          maxLines: 7, minScale: 0.6,
        }],
      },
    ],
  };
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}
