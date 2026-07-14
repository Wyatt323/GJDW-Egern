import stateGridWidget from "./state-grid-widget.js";

const VERSION = "1.6.3";

export default async function manualUpdate(ctx) {
  void VERSION;
  return stateGridWidget({
    ...ctx,
    env: { ...(ctx.env || {}), RUN_MODE: "update" },
  });
}
