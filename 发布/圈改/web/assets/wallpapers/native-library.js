export function requestLibrary(command) {
  const bridge = window.chrome?.webview;
  if (!bridge) return Promise.reject(Error("本机壁纸库需要在圈改桌面版中打开。"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error("读取壁纸库超时，请刷新重试。")), command === "wallpaper-folder" ? 300000 : 60000);
    function finish(error, value) {
      clearTimeout(timeout);
      bridge.removeEventListener("message", receive);
      if (error) reject(error); else resolve(value);
    }
    function receive({ data }) {
      if (data?.type !== "wallpaper-response" || data.requestId !== requestId) return;
      finish(data.ok ? null : Error(data.message || "无法读取壁纸库。"), data.cancelled ? null : data.result);
    }
    bridge.addEventListener("message", receive);
    bridge.postMessage({ type: "wallpaper-request", requestId, command });
  });
}
