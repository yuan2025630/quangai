import { createProjectCompletion } from "../review/project-completion.js?version=20261013-projects";
import { createProjectFileSave } from "./project-file-save.js";

export function installProjectCompletion({
  document,
  bridge,
  getProject,
  isBusy,
  runBusy,
  markSaved,
  filename,
  notify,
  showError,
  setCompletedProject,
  flushManagedProjects,
}) {
  const button = document.getElementById("complete-project");
  const app = document.getElementById("app");
  const saveFile = createProjectFileSave({
    bridge,
    makeId: () => crypto.randomUUID(),
    filename,
    operation: "completed-project",
    suggestedName: (project) =>
      `${filename(project.title)}-已完成.quangai.json`,
    browserPicker: window.showSaveFilePicker?.bind(window),
  });
  const controller = createProjectCompletion({
    getProject,
    isBusy,
    saveFile,
    markSaved,
    now: () => new Date(),
    setCompletedProject,
    runBusy: async (task) => {
      const wasInert = app.inert;
      app.inert = true;
      try {
        await flushManagedProjects?.();
        await runBusy(task);
      } finally {
        app.inert = wasInert;
      }
    },
    onSaved: ({ path, currentChanged, warning }) => {
      if (currentChanged) {
        notify("已保存完成时的项目快照；当前新修改仍保留。");
        return;
      }
      notify(
        `项目已完成并保存，仍可切换查看。保存位置：${path}${warning ? ` · ${warning}` : ""}`,
      );
    },
  });
  function render() {
    const project = getProject();
    button.disabled =
      isBusy() || controller.pending || !project.images.original;
    button.querySelector("span").textContent = controller.pending
      ? "正在保存…"
      : "完成并保存";
  }
  button.addEventListener("click", async () => {
    try {
      await controller.complete();
    } catch (error) {
      showError(error);
    } finally {
      render();
    }
  });
  render();
  return { render };
}
