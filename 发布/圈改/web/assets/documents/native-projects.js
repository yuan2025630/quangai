const pickedFiles = new WeakMap();
export function registerPickedFile(file, token) { if (token) pickedFiles.set(file, token); }

export function createProjectRequests(bridge, onProgress) {
  const pending = new Map();
  bridge?.addEventListener('message', ({ data }) => {
    const request = pending.get(data?.requestId);
    if (!request) return;
    if (data.type === 'project-progress') { onProgress(data.message); return; }
    if (data.type !== 'project-command-response') return;
    pending.delete(data.requestId); clearTimeout(request.timeout);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.message || '项目操作失败。'));
  });
  return (command, payload = {}, file = null) => {
    if (!bridge?.postMessage) return Promise.reject(new Error('文件与项目管理需要使用圈改桌面版。'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('项目操作超时，请检查文件后重试。')); }, 240000);
      pending.set(id, { resolve, reject, timeout });
      try {
        const message = { type: 'project-command', requestId: id, command, ...payload };
        const token = file && pickedFiles.get(file);
        if (token) bridge.postMessage({ ...message, fileToken: token });
        else if (file) bridge.postMessageWithAdditionalObjects(message, [file]);
        else bridge.postMessage(message);
      } catch (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
    });
  };
}
