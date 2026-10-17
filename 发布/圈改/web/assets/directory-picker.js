// Native directory selection must finish before creating a project or exporting files.
export function installDirectoryPickers(
  document,
  bridge,
  makeId,
  { onNewProject, getManagedProjectId } = {},
) {
  if (!bridge?.postMessage || !bridge?.addEventListener) return;
  let pending = null;
  let continueAction = false;
  const pickers = {
    "new-project": "project-folder",
    "export-agent": "agent-folder",
  };

  function showError(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message || "无法选择文件夹，请重试。";
    toast.className = "toast error";
    toast.hidden = false;
  }

  bridge.addEventListener("message", ({ data }) => {
    if (
      !pending?.responseType ||
      data?.type !== pending.responseType ||
      data.requestId !== pending.id
    )
      return;
    const button = pending.button;
    const wasDisabled = pending.wasDisabled;
    pending = null;
    button.disabled = wasDisabled;
    if (!data.ok) {
      showError(data.message);
      return;
    }
    if (data.cancelled) return;
    continueAction = true;
    try {
      button.click();
    } finally {
      continueAction = false;
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.("#new-project, #export-agent");
      if (!button || continueAction) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (
        pending ||
        button.disabled ||
        document.body.getAttribute("aria-busy") === "true"
      )
        return;
      if (button.id === "new-project" && onNewProject) {
        pending = { button, wasDisabled: button.disabled };
        button.disabled = true;
        Promise.resolve()
          .then(onNewProject)
          .catch((error) => showError(error.message))
          .finally(() => {
            button.disabled = pending.wasDisabled;
            pending = null;
          });
        return;
      }
      const type = pickers[button.id];
      if (!type) return;
      pending = {
        id: makeId(),
        button,
        wasDisabled: button.disabled,
        responseType: `${type}-response`,
      };
      button.disabled = true;
      try {
        bridge.postMessage({ type: `${type}-request`, requestId: pending.id, storageId: getManagedProjectId?.() });
      } catch (error) {
        button.disabled = pending.wasDisabled;
        pending = null;
        showError(error.message);
      }
    },
    true,
  );
}
