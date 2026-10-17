const PARENT_ORIGIN = "https://quangai.local";
const query = new URLSearchParams(location.search);
const token = query.get("token");
const kind = query.get("kind");
const source = query.get("source");
const url = query.get("media");
const reply = (type, detail = {}) => parent.postMessage({ type, token, ...detail }, PARENT_ORIGIN);
let media;
let destroyed = false;
let ready = false;
try {
  if (!/^https:\/\/entry-[a-f0-9]{20}\.quangai-wallpaper\.local\/$/.test(source ?? "") || !url?.startsWith(source) || !["video", "image"].includes(kind)) throw Error("壁纸来源无效。");
  media = document.createElement(kind === "video" ? "video" : "img");
  if (kind === "video") Object.assign(media, { muted: true, loop: true, playsInline: true, preload: "auto" });
  else media.alt = "";
  const loaded = () => { if (!destroyed && !ready) { ready = true; reply("wallpaper-ready", { kind }); } };
  media.addEventListener(kind === "video" ? "loadeddata" : "load", loaded, { once: true });
  media.addEventListener("error", () => {
    if (!destroyed) reply("wallpaper-error", { message: kind === "video" ? "视频无法解码，请换用 MP4（H.264）或 WebM。" : "图片无法读取。" });
  });
  media.src = url;
  document.body.append(media);
} catch (error) { reply("wallpaper-error", { message: error.message }); }

window.addEventListener("message", event => {
  if (event.origin !== PARENT_ORIGIN || event.source !== parent || event.data?.token !== token || event.data.type !== "wallpaper-control" || !media) return;
  const { destroy, fit, volume, speed, play } = event.data;
  if (destroy) { destroyed = true; if (kind === "video") media.pause(); media.removeAttribute("src"); media.remove(); return; }
  if (["cover", "contain", "stretch"].includes(fit)) media.style.objectFit = fit === "stretch" ? "fill" : fit;
  if (kind !== "video") return;
  if (Number.isFinite(volume)) { media.volume = Math.max(0, Math.min(1, volume)); media.muted = volume === 0; }
  if (Number.isFinite(speed)) media.playbackRate = Math.max(.5, Math.min(2, speed));
  if (play) media.play().catch(error => reply("wallpaper-error", { message: error.message }));
  else media.pause();
});
window.addEventListener("pagehide", () => { destroyed = true; if (kind === "video") media?.pause(); });
