export function createProjectFileSave({
  bridge,
  makeId,
  filename,
  browserPicker,
  operation = "project",
  suggestedName = (project) => `${filename(project.title)}.quangai.json`,
}) {
  let pending = null;
  bridge?.addEventListener("message", ({ data }) => {
    if (
      data?.type !== `${operation}-save-response` ||
      data.requestId !== pending?.id
    )
      return;
    const request = pending;
    pending = null;
    if (!data.ok)
      request.reject(new Error(data.message || "项目未能保存，请重试。"));
    else
      request.resolve({
        cancelled: !!data.cancelled,
        path: data.path,
        storageId: data.storageId,
        warning: data.warning,
      });
  });
  return async (project) => {
    const projectJson = JSON.stringify(project);
    const name = suggestedName(project);
    if (bridge?.postMessage) {
      if (pending) throw new Error("项目正在保存。");
      return new Promise((resolve, reject) => {
        pending = { id: makeId(), resolve, reject };
        try {
          bridge.postMessage({
            type: `${operation}-save-request`,
            requestId: pending.id,
            filename: name,
            projectJson,
          });
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    }
    if (!browserPicker)
      throw new Error("此浏览器无法确认保存结果，请使用圈改桌面版。");
    let handle;
    try {
      handle = await browserPicker({
        suggestedName: name,
        types: [
          {
            description: "圈改项目",
            accept: { "application/json": [".json"] },
          },
        ],
      });
    } catch (error) {
      if (error.name === "AbortError") return { cancelled: true };
      throw error;
    }
    const file = await handle.createWritable();
    try {
      await file.write(projectJson);
      await file.close();
    } catch (error) {
      await file.abort();
      throw error;
    }
    return { cancelled: false, path: handle.name };
  };
}
