import { APPEARANCE_DEFAULTS, PLAYBACK_DEFAULTS, applyAppearance, normalizeSettings } from "./wallpapers/appearance.js?version=20261013";
import { WallpaperPlayback } from "./wallpapers/playback.js?version=20261013";
import { requestLibrary } from "./wallpapers/native-library.js?version=20261013";

const EMPTY_BACKGROUND = { id: "none", name: "纯色背景", kind: "image", src: null, source: "安静的工作背景" };
const KIND_NAMES = { image: "图片", video: "视频", scene: "场景", web: "网页" };
const typeOf = item => item.kind ?? (item.video || item.videoBlob ? "video" : "image");
const storedIds = value => new Set(Array.isArray(value) ? value.filter(id => typeof id === "string").slice(0, 4000) : []);

function settingsMarkup() {
  const slider = (name, label, min, max, step, unit) => `<label class="wallpaper-setting"><span>${label}<output data-value="${name}" data-unit="${unit}"></output></span><input type="range" data-setting="${name}" min="${min}" max="${max}" step="${step}" aria-label="${label}"></label>`;
  return `<div class="wallpaper-tabs" role="tablist" aria-label="壁纸设置">
    <button type="button" role="tab" id="wp-tab-library" aria-selected="true" aria-controls="wp-library" data-tab="library">壁纸库</button>
    <button type="button" role="tab" id="wp-tab-appearance" aria-selected="false" aria-controls="wp-appearance" data-tab="appearance" tabindex="-1">外观</button>
    <button type="button" role="tab" id="wp-tab-playback" aria-selected="false" aria-controls="wp-playback" data-tab="playback" tabindex="-1">播放</button>
  </div>
  <section id="wp-library" role="tabpanel" aria-labelledby="wp-tab-library">
    <div class="wallpaper-toolbar"><label class="wallpaper-search"><span class="sr-only">搜索壁纸名称</span><input id="wallpaper-search" type="search" placeholder="搜索壁纸名称…" autocomplete="off"></label>
    <select id="wallpaper-kind" aria-label="筛选壁纸类型"><option value="all">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="scene">场景</option><option value="web">网页</option></select>
    <label class="wallpaper-toggle"><input id="wallpaper-favorites" type="checkbox">只看收藏</label></div>
    <div class="wallpaper-library-info"><span id="wallpaper-count">正在读取本机壁纸库…</span><label class="wallpaper-toggle"><input id="wallpaper-hidden" type="checkbox">显示已隐藏</label></div>
    <div id="wallpaper-grid" class="wallpaper-grid"></div>
    <div class="wallpaper-library-actions"><button type="button" id="choose-wallpaper" class="text-button">添加图片 / 视频</button><button type="button" id="wallpaper-folder" class="text-button">添加壁纸库目录</button><button type="button" id="wallpaper-refresh" class="text-button">刷新壁纸库</button></div>
    <p class="wallpaper-help">自动读取本机 Wallpaper Engine 库。隐藏仅影响列表；场景与网页按兼容性加载，应用程序壁纸不支持。</p>
  </section>
  <section id="wp-appearance" role="tabpanel" aria-labelledby="wp-tab-appearance" hidden>
    <div class="wallpaper-presets"><span>快速外观</span><button type="button" data-preset="default">默认</button><button type="button" data-preset="focus">专注</button><button type="button" data-preset="clear">通透</button></div>
    <div class="wallpaper-settings-grid"><fieldset><legend>背景画面</legend>
    ${slider("blur", "背景模糊", 0, 24, 1, "px")}${slider("brightness", "亮度", 50, 150, 1, "%")}${slider("saturation", "饱和度", 0, 150, 1, "%")}${slider("dim", "暗化", 0, 65, 1, "%")}
    <label class="wallpaper-setting"><span>画面适配</span><select data-setting="fit" aria-label="画面适配"><option value="cover">铺满（裁切边缘）</option><option value="contain">完整显示</option><option value="stretch">拉伸填满</option></select></label>
    <label class="wallpaper-toggle"><input type="checkbox" data-setting="flip">水平镜像背景</label></fieldset>
    <fieldset><legend>工作台玻璃</legend>${slider("glassOpacity", "面板不透明度", 45, 85, 1, "%")}${slider("glassBlur", "玻璃模糊", 0, 32, 1, "px")}
    <p class="wallpaper-help">只调整工作台背景与面板。正在编辑的图片和导出结果保持原色。</p></fieldset></div>
  </section>
  <section id="wp-playback" role="tabpanel" aria-labelledby="wp-tab-playback" hidden>
    <div class="wallpaper-settings-grid"><fieldset><legend>动态播放</legend>
    <label class="wallpaper-toggle"><input id="wallpaper-motion" data-setting="animated" type="checkbox">播放动态壁纸</label>
    <label class="wallpaper-toggle"><input data-setting="pauseWhenBlurred" type="checkbox">切换到其他窗口时暂停</label>
    ${slider("speed", "视频播放速度", 0.5, 2, 0.25, "×")}${slider("volume", "音量", 0, 100, 1, "%")}
    <label class="wallpaper-setting"><span>场景帧率上限</span><select data-setting="fps" aria-label="场景帧率上限"><option value="30">30 FPS · 省资源</option><option value="60">60 FPS · 更流畅</option></select></label>
    <p class="wallpaper-help">默认静音。窗口不可见时自动暂停；速度调节适用于视频。</p></fieldset>
    <fieldset><legend>收藏轮播</legend><label class="wallpaper-toggle"><input data-setting="rotation" type="checkbox">轮播已收藏的壁纸</label>
    <label class="wallpaper-setting"><span>切换间隔（秒）</span><input type="number" min="30" max="3600" step="30" data-setting="interval" aria-label="切换间隔（秒）"></label>
    <label class="wallpaper-toggle"><input data-setting="shuffle" type="checkbox">随机顺序</label>
    <p class="wallpaper-help">至少收藏两张壁纸。打开此面板、切换到其他窗口或隐藏窗口时暂停轮播。</p></fieldset></div>
  </section><p id="wallpaper-status" class="wallpaper-status" role="status" aria-live="polite"></p>`;
}

export async function installWallpapers({ builtIn, readPreferences, savePreferences, readImage, readVideo, chooseFile, renderIcon, showError }) {
  const dialog = document.getElementById("wallpaper-dialog");
  const header = dialog.querySelector(".dialog-heading");
  dialog.replaceChildren(header);
  dialog.insertAdjacentHTML("beforeend", settingsMarkup());
  dialog.querySelector("h2").textContent = "壁纸与氛围";
  const grid = document.getElementById("wallpaper-grid");
  const input = document.getElementById("wallpaper-input");
  const status = document.getElementById("wallpaper-status");
  const caption = document.getElementById("wallpaper-caption");
  const search = document.getElementById("wallpaper-search");
  const filter = document.getElementById("wallpaper-kind");
  const favoritesOnly = document.getElementById("wallpaper-favorites");
  const showHidden = document.getElementById("wallpaper-hidden");
  const count = document.getElementById("wallpaper-count");
  const player = new WallpaperPlayback(error => { status.textContent = error.message; });
  let selected = EMPTY_BACKGROUND;
  let customs = [];
  let library = [];
  let deleted = new Set();
  let favorites = new Set();
  let appearance = { ...APPEARANCE_DEFAULTS };
  let playback = { ...PLAYBACK_DEFAULTS };
  let busy = false;
  let scanning = false;
  let userSelections = 0;
  let savedSelection = null;
  let saveTimer;
  let rotationTimer;
  let writeTail = Promise.resolve();
  const all = () => [...builtIn, ...customs, ...library, EMPTY_BACKGROUND];
  const available = () => all().filter(item => !deleted.has(item.id));
  const preferences = (overrides = {}) => ({
    version: 3, selected: selected.id, customs, deleted: [...deleted], favorites: [...favorites],
    animated: playback.animated, appearance, playback, ...overrides,
  });
  function persist(overrides = {}) {
    clearTimeout(saveTimer);
    const snapshot = preferences(overrides);
    const next = writeTail.catch(() => {}).then(() => savePreferences(snapshot));
    writeTail = next;
    return next;
  }
  function saveSettings(immediate = false) {
    clearTimeout(saveTimer);
    const save = () => { void persist().catch(error => { status.textContent = `设置未保存：${error.message}`; }); };
    if (immediate) save(); else saveTimer = setTimeout(save, 400);
  }
  function updateSettings() {
    applyAppearance(appearance);
    player.update(playback, appearance);
    for (const control of dialog.querySelectorAll("[data-setting]")) {
      const key = control.dataset.setting;
      const value = key in appearance ? appearance[key] : playback[key];
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
      const output = dialog.querySelector(`[data-value="${key}"]`);
      if (output) output.textContent = `${value}${output.dataset.unit}`;
      if (key === "speed") control.disabled = typeOf(selected) !== "video";
      if (key === "fps") control.disabled = typeOf(selected) !== "scene";
    }
    scheduleRotation();
  }
  function updateControls() {
    for (const button of grid.querySelectorAll("button")) button.disabled = busy || Boolean(button.dataset.wallpaper && deleted.has(button.dataset.wallpaper));
    for (const choice of grid.querySelectorAll("[data-wallpaper]")) choice.setAttribute("aria-pressed", String(choice.dataset.wallpaper === selected.id));
    document.getElementById("choose-wallpaper").disabled = busy;
    document.getElementById("wallpaper-refresh").disabled = scanning;
    document.getElementById("wallpaper-folder").disabled = scanning;
  }
  async function selectWallpaper(wallpaper, { user = true, nextCustoms = customs, persistSelection = true } = {}) {
    if (busy) return false;
    if (user) ++userSelections;
    busy = true;
    updateControls();
    status.textContent = `正在加载：${wallpaper.name}…`;
    let resource;
    try {
      resource = await player.prepare(wallpaper);
      if (persistSelection) await persist({ selected: wallpaper.id, customs: nextCustoms });
      customs = nextCustoms;
      selected = wallpaper;
      player.commit(resource);
      document.body.dataset.wallpaper = wallpaper.id;
      document.body.dataset.wallpaperKind = typeOf(wallpaper);
      caption.textContent = `${wallpaper.name} · 把注意力留给画面`;
      status.textContent = `已切换：${wallpaper.name}。${persistSelection ? "下次打开会保留。" : ""}`;
      updateSettings();
      renderChoices();
      return true;
    } catch (error) {
      resource?.destroy();
      status.textContent = `${error.message} 当前壁纸已保留。`;
      return false;
    } finally { busy = false; updateControls(); scheduleRotation(); }
  }
  async function toggleFavorite(item) {
    const previous = new Set(favorites);
    if (favorites.has(item.id)) favorites.delete(item.id); else favorites.add(item.id);
    try { await persist(); renderChoices(); scheduleRotation(); }
    catch (error) { favorites = previous; status.textContent = `收藏未保存：${error.message}`; }
  }
  async function toggleHidden(item) {
    const previous = new Set(deleted);
    if (deleted.has(item.id)) deleted.delete(item.id); else deleted.add(item.id);
    try {
      await persist(); renderChoices(); scheduleRotation();
      status.textContent = deleted.has(item.id) ? `已隐藏：${item.name}。可勾选“显示已隐藏”恢复。` : `已恢复：${item.name}。`;
    } catch (error) { deleted = previous; status.textContent = `列表未保存：${error.message}`; }
  }
  function createChoice(item) {
    const card = document.createElement("div");
    card.className = "wallpaper-card";
    if (deleted.has(item.id)) card.classList.add("wallpaper-card-hidden");
    const choice = document.createElement("button");
    choice.type = "button"; choice.className = "wallpaper-choice"; choice.dataset.wallpaper = item.id;
    const thumbnail = new Image();
    thumbnail.src = item.thumbnail ?? item.src ?? "/wallpaper.svg";
    thumbnail.alt = ""; thumbnail.loading = "lazy"; thumbnail.decoding = "async";
    thumbnail.onerror = () => { thumbnail.onerror = null; thumbnail.src = "/wallpaper.svg"; };
    const name = document.createElement("strong"); name.textContent = item.name; name.title = item.name;
    const source = document.createElement("small"); source.textContent = `${KIND_NAMES[typeOf(item)]} · ${item.source}`;
    const check = document.createElement("span"); check.className = "wallpaper-check"; check.innerHTML = renderIcon("check", 16);
    choice.append(thumbnail, name, source, check);
    choice.addEventListener("click", () => { void selectWallpaper(item); });
    const actions = document.createElement("div"); actions.className = "wallpaper-card-actions";
    const star = document.createElement("button");
    star.type = "button"; star.className = "text-button wallpaper-favorite";
    star.setAttribute("aria-label", `收藏壁纸：${item.name}`);
    star.setAttribute("aria-pressed", String(favorites.has(item.id)));
    star.textContent = favorites.has(item.id) ? "★ 已收藏" : "☆ 收藏";
    star.addEventListener("click", () => { void toggleFavorite(item); });
    const hide = document.createElement("button"); hide.type = "button"; hide.className = "text-button wallpaper-hide";
    hide.textContent = deleted.has(item.id) ? "恢复" : "隐藏";
    hide.setAttribute("aria-label", `${hide.textContent}壁纸：${item.name}`);
    hide.addEventListener("click", () => { void toggleHidden(item); });
    actions.append(star, hide); card.append(choice, actions);
    return card;
  }
  function renderChoices() {
    const query = search.value.trim().toLocaleLowerCase();
    const choices = all().filter(item => (showHidden.checked || !deleted.has(item.id))
      && (filter.value === "all" || typeOf(item) === filter.value)
      && (!favoritesOnly.checked || favorites.has(item.id))
      && item.name.toLocaleLowerCase().includes(query));
    grid.replaceChildren(...choices.map(createChoice));
    if (!choices.length) {
      const empty = document.createElement("p"); empty.className = "wallpaper-empty";
      empty.textContent = "没有匹配的壁纸，试试清除筛选或添加本机文件。"; grid.append(empty);
    }
    count.textContent = `${choices.length} 张壁纸 · 本机库 ${library.length} 张 · 收藏 ${available().filter(item => favorites.has(item.id)).length} 张`;
    updateControls();
  }
  async function refreshLibrary(command = "wallpaper-scan") {
    if (scanning) return;
    scanning = true; updateControls();
    count.textContent = "正在读取本机壁纸库…";
    try {
      const inventory = await requestLibrary(command);
      if (!inventory) return;
      library = inventory.items;
      if (inventory.warnings.length) status.textContent = `已读取 ${library.length} 张壁纸，跳过 ${inventory.warnings.length} 个不可用项目。`;
      if (savedSelection?.startsWith("we-") && userSelections === 0 && !busy) {
        const restored = available().find(item => item.id === savedSelection);
        savedSelection = null;
        if (restored) await selectWallpaper(restored, { user: false, persistSelection: false });
        else status.textContent = "上次的本机壁纸未找到，已使用内置背景。可添加原壁纸库目录。";
      }
    } catch (error) { status.textContent = error.message; }
    finally { scanning = false; renderChoices(); scheduleRotation(); }
  }
  function scheduleRotation() {
    clearTimeout(rotationTimer);
    if (!playback.rotation || document.hidden || player.minimized || dialog.open || !document.hasFocus() || busy) return;
    const candidates = available().filter(item => favorites.has(item.id));
    if (candidates.length < 2) return;
    rotationTimer = setTimeout(async () => {
      const others = candidates.filter(item => item.id !== selected.id);
      const current = candidates.findIndex(item => item.id === selected.id);
      const next = playback.shuffle ? others[Math.floor(Math.random() * others.length)] : candidates[(current + 1) % candidates.length];
      await selectWallpaper(next, { user: false }); scheduleRotation();
    }, playback.interval * 1000);
  }

  try {
    const saved = await readPreferences();
    appearance = normalizeSettings(APPEARANCE_DEFAULTS, saved?.appearance);
    if ((saved?.version ?? 0) < 3) appearance.glassOpacity = APPEARANCE_DEFAULTS.glassOpacity;
    playback = normalizeSettings(PLAYBACK_DEFAULTS, saved?.playback ?? { animated: saved?.animated });
    deleted = storedIds(saved?.deleted); favorites = storedIds(saved?.favorites);
    const candidates = Array.isArray(saved?.customs) ? saved.customs : saved?.custom ? [saved.custom] : [];
    customs = candidates.filter(item => typeof item?.id === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(item.src) && typeof item.name === "string").slice(0, 30);
    savedSelection = saved?.selected;
    updateSettings();
    const restored = available().find(item => item.id === savedSelection) ?? available()[0] ?? EMPTY_BACKGROUND;
    if (!await selectWallpaper(restored, { user: false, persistSelection: false }))
      await selectWallpaper(builtIn.find(item => !deleted.has(item.id)) ?? EMPTY_BACKGROUND, { user: false, persistSelection: false });
  } catch (error) { showError(Error(`壁纸设置未恢复：${error.message}`, { cause: error })); }
  renderChoices();
  void refreshLibrary();

  document.getElementById("wallpaper-button").addEventListener("click", () => {
    status.textContent = `当前壁纸：${selected.name}`; dialog.showModal(); scheduleRotation();
  });
  dialog.addEventListener("close", () => { saveSettings(true); scheduleRotation(); });
  document.getElementById("choose-wallpaper").addEventListener("click", () => { chooseFile(input); });
  document.getElementById("wallpaper-folder").addEventListener("click", () => { void refreshLibrary("wallpaper-folder"); });
  document.getElementById("wallpaper-refresh").addEventListener("click", () => { void refreshLibrary(); });
  for (const control of [search, filter, favoritesOnly, showHidden]) control.addEventListener("input", renderChoices);
  for (const tab of dialog.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => {
      for (const button of dialog.querySelectorAll("[data-tab]")) {
        const active = button === tab;
        button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
        document.getElementById(button.getAttribute("aria-controls")).hidden = !active;
      }
    });
    tab.addEventListener("keydown", event => {
      const tabs = [...dialog.querySelectorAll("[data-tab]")];
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!offset) return;
      event.preventDefault(); const next = tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length]; next.click(); next.focus();
    });
  }
  for (const control of dialog.querySelectorAll("[data-setting]")) {
    control.addEventListener("input", () => {
      const key = control.dataset.setting;
      const group = key in appearance ? appearance : playback;
      const value = control.type === "checkbox" ? control.checked : key === "fit" ? control.value : Number(control.value);
      const normalized = normalizeSettings(key in appearance ? APPEARANCE_DEFAULTS : PLAYBACK_DEFAULTS, { ...group, [key]: value });
      if (key in appearance) appearance = normalized; else playback = normalized;
      updateSettings(); saveSettings(control.type !== "range");
      if (key === "rotation" && playback.rotation && available().filter(item => favorites.has(item.id)).length < 2)
        status.textContent = "请先收藏至少两张壁纸，轮播会自动开始。";
    });
    control.addEventListener("change", () => saveSettings(true));
  }
  for (const preset of dialog.querySelectorAll("[data-preset]")) preset.addEventListener("click", () => {
    const choices = { default: APPEARANCE_DEFAULTS, focus: { ...APPEARANCE_DEFAULTS, blur: 10, dim: 35, glassOpacity: 80 }, clear: { ...APPEARANCE_DEFAULTS, dim: 0, glassOpacity: 48, glassBlur: 24 } };
    appearance = { ...choices[preset.dataset.preset] }; updateSettings(); saveSettings(true);
  });
  document.addEventListener("visibilitychange", scheduleRotation);
  window.chrome?.webview?.addEventListener("message", ({ data }) => { if (data?.type === "window-state") scheduleRotation(); });
  window.addEventListener("focus", scheduleRotation); window.addEventListener("blur", scheduleRotation);
  input.addEventListener("change", async () => {
    const file = input.files[0]; input.value = "";
    if (!file || busy) return;
    if (customs.length >= 30) { status.textContent = "本机导入已达 30 张。视频较多时请使用壁纸库目录，避免重复保存大文件。"; return; }
    busy = true; updateControls(); status.textContent = "正在读取壁纸…";
    try {
      let item;
      if (file.type.startsWith("video/") || /\.(mp4|webm)$/i.test(file.name)) item = await readVideo(file);
      else { const image = await readImage(file); item = { name: file.name, src: image.src, source: "本机图片" }; }
      item.id = customs.some(item => item.id === "custom") ? `custom-${crypto.randomUUID()}` : "custom";
      busy = false;
      await selectWallpaper(item, { nextCustoms: [...customs, item] });
    } catch (error) { status.textContent = `无法导入：${error.message}`; }
    finally { busy = false; updateControls(); }
  });
}
