const VERSION = "1.4.0";

export default async function (ctx) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#245A4A",
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
        text: "组件脚本加载正常",
        font: { size: "body", weight: "semibold" },
        textColor: "#C8FFF2",
        maxLines: 1,
      },
      {
        type: "text",
        text: `尺寸：${String(ctx.widgetFamily || "unknown")}\nEgern：${String(ctx.app?.version || "unknown")}\n时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        font: { size: "caption1" },
        textColor: "#FFFFFFCC",
        maxLines: 4,
      },
    ],
  };
}
