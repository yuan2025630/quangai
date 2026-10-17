const ICONS = {
  minimize: '<path d="M3 8h10"/>',
  maximize: '<rect x="3.5" y="3.5" width="9" height="9"/>',
  restore: '<path d="M6 3.5V2h8v8h-1.5"/><rect x="2" y="5" width="9" height="9"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
};

function icon(name) {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${ICONS[name]}</svg>`;
}

const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_DISTANCE = 5;

/** Forward caption gestures to the native host without intercepting project controls. */
export function installWindowControls({ document, titlebar, bridge, showError }) {
  if (!bridge?.postMessage || !bridge?.addEventListener) return;
  const spacer = document.createElement("div");
  spacer.className = "window-drag-region";
  spacer.setAttribute("aria-hidden", "true");
  const controls = document.createElement("div");
  controls.className = "window-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "窗口控制");
  const buttons = new Map();
  let lastCaptionPress = null;

  function send(command, values = {}) {
    try { bridge.postMessage({ type: "window-request", command, ...values }); }
    catch (error) { showError(error); }
  }
  for (const [command, label] of [["minimize", "最小化"], ["maximize", "最大化"], ["close", "关闭窗口"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `window-control window-${command}`;
    button.dataset.windowCommand = command;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(command);
    button.addEventListener("click", () => send(command));
    controls.append(button);
    buttons.set(command, button);
  }
  titlebar.append(spacer, controls);
  titlebar.classList.add("desktop-titlebar");
  // WebView owns mouse input at the edges once the native frame becomes client area.
  const resizeFrame = document.createElement("div");
  resizeFrame.className = "window-resize-frame";
  resizeFrame.setAttribute("aria-hidden", "true");
  for (const [direction, edge] of [["left", 10], ["right", 11], ["top", 12],
    ["top-left", 13], ["top-right", 14], ["bottom", 15], ["bottom-left", 16], ["bottom-right", 17]]) {
    const handle = document.createElement("div");
    handle.className = `window-resize-handle window-resize-${direction}`;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || document.documentElement.dataset.windowState !== "normal") return;
      event.preventDefault();
      send("resize", { edge });
    });
    resizeFrame.append(handle);
  }
  document.body.append(resizeFrame);
  titlebar.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.defaultPrevented ||
      event.target.closest(".project-tab,.project-tab-add,.window-controls,button,input")
    ) {
      lastCaptionPress = null;
      return;
    }
    event.preventDefault();
    const press = { time: event.timeStamp, x: event.screenX, y: event.screenY };
    const isDoubleClick = lastCaptionPress &&
      press.time - lastCaptionPress.time >= 0 &&
      press.time - lastCaptionPress.time <= DOUBLE_CLICK_MS &&
      Math.hypot(press.x - lastCaptionPress.x, press.y - lastCaptionPress.y) <= DOUBLE_CLICK_DISTANCE;
    lastCaptionPress = isDoubleClick ? null : press;
    send(isDoubleClick ? "maximize" : "drag");
  });
  bridge.addEventListener("message", ({ data }) => {
    if (data?.type !== "window-state" || typeof data.isMaximized !== "boolean") return;
    const button = buttons.get("maximize");
    const label = data.isMaximized ? "向下还原" : "最大化";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(data.isMaximized ? "restore" : "maximize");
    document.documentElement.dataset.windowState = data.isMaximized ? "maximized" : "normal";
  });
  send("state");
}
