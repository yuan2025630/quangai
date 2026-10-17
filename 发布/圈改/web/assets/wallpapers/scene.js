import { mount, httpSource } from "./webwallgl/webwallgl.min.mjs";

const PARENT_ORIGIN = "https://quangai.local";
const query = new URLSearchParams(location.search);
const token = query.get("token");
const source = query.get("source");
let instance;
let destroyed = false;
const reply = (type, detail = {}) => parent.postMessage({ type, token, ...detail }, PARENT_ORIGIN);

window.addEventListener("message", event => {
  if (event.origin !== PARENT_ORIGIN || event.source !== parent || event.data?.token !== token || event.data.type !== "wallpaper-control") return;
  const { destroy, play, fit, fps, volume } = event.data;
  if (destroy) { destroyed = true; instance?.destroy(); instance = null; return; }
  if (!instance) return;
  if (["cover", "contain", "stretch"].includes(fit)) instance.setFit(fit);
  if ([30, 60].includes(fps)) instance.setFps(fps);
  if (Number.isFinite(volume)) instance.setVolume(Math.max(0, Math.min(1, volume)));
  if (play) instance.resume(); else instance.pause();
});
window.addEventListener("pagehide", () => { destroyed = true; instance?.destroy(); });

try {
  if (!/^https:\/\/entry-[a-f0-9]{20}\.quangai-wallpaper\.local\/$/.test(source ?? "")) throw Error("壁纸来源无效。");
  instance = await mount(document.getElementById("scene"), {
    source: httpSource(source), autoplay: true, volume: 0, sceneFps: 30,
    webSandbox: "strict", mountTimeoutMs: 40000,
    onError: error => reply("wallpaper-error", { message: error?.message || String(error) }),
  });
  if (destroyed) instance.destroy();
  else reply("wallpaper-ready", { kind: instance.info?.type ?? "scene" });
} catch (error) {
  error.instance?.destroy();
  if (!destroyed) reply("wallpaper-error", { message: error.message });
}
