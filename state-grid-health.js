const VERSION = "1.5.2";
const DIAGNOSTIC_KEY = "state_grid_diagnostic_v1";
const STATUS_KEY = "state_grid_capture_status_v2";

export default async function (ctx) {
  const trace = ctx.storage.getJSON(DIAGNOSTIC_KEY) || null;
  const status = ctx.storage.getJSON(STATUS_KEY) || null;
  const events = Array.isArray(trace?.events) ? trace.events.slice(-6) : [];
  const lines = events.length
    ? events.map((event) => `${timeLabel(event.at)}  ${event.message}`).join("\n")
    : "暂无诊断记录\n请先运行一次“国家电网·更新数据”";
  const color = status?.kind === "error" ? "#FFD5D2" : "#C8FFF2";

  return {
    type: "widget",
    padding: 15,
    gap: 7,
    backgroundColor: "#245A4A",
    refreshAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    children: [
      {
        type: "text",
        text: `国家电网诊断 · v${VERSION}`,
        font: { size: "headline", weight: "bold" },
        textColor: "#FFFFFF",
        maxLines: 1,
        minScale: 0.6,
      },
      {
        type: "text",
        text: status?.message || "等待查询诊断",
        font: { size: "caption1", weight: "semibold" },
        textColor: color,
        maxLines: 2,
        minScale: 0.7,
      },
      {
        type: "text",
        text: lines,
        font: { size: "caption2" },
        textColor: "#FFFFFFCC",
        maxLines: 8,
        minScale: 0.65,
      },
    ],
  };
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}
