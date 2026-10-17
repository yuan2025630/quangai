import { createProjectSaveMarker } from "../storage/project-save-marker.js";
import { createProjectFileSave } from "./project-file-save.js";
import { createProjectCloseDialog } from "./project-close-dialog.js?version=20261007-exit";

export function installProjectFiles({ document, bridge, getProject, getWorkspace, isBusy, runBusy, persistWorkspace, filename, notify, showError, newManagedProject, flushManagedProjects, manageProjects }) {
  const marker = createProjectSaveMarker(window.localStorage, window.crypto);
  const saveFile = createProjectFileSave({
    bridge,
    makeId: () => crypto.randomUUID(),
    filename,
    browserPicker: window.showSaveFilePicker?.bind(window),
  });
  const chooseAction = createProjectCloseDialog(document);
  const app = document.getElementById("app");
  let pendingClose = false;
  async function locked(task) {
    const previous = app.inert;
    app.inert = true;
    try { return await runBusy(task); }
    finally { app.inert = previous; }
  }
  function findSession(project) {
    return getWorkspace().sessions.find((session) => session.history.current === project);
  }
  async function markSaved(project, session = findSession(project)) {
    if (!session) return;
    session.saveState.markSaved(project);
    persistWorkspace();
  }
  async function saveSnapshot(project, session) {
    const result = await saveFile(project);
    if (!result.cancelled) {
      if (result.storageId) session.history.bindStorage(result.storageId);
      await markSaved(project, session);
      notify(`项目已保存：${result.path}${result.warning ? ` · ${result.warning}` : ""}`);
    }
    return result;
  }
  return {
    markSaved,
    async newProject() {
      if (isBusy() || pendingClose) return;
      if (newManagedProject) { await locked(newManagedProject); return; }
      getWorkspace().add();
      notify("已新建项目，其他项目仍保留在标签中。");
    },
    async close(id) {
      if (isBusy() || pendingClose) return;
      const workspace = getWorkspace();
      const session = workspace.sessions.find((item) => item.id === id);
      if (!session) return;
      pendingClose = true;
      try {
        await locked(async () => {
          await flushManagedProjects?.();
          const project = session.history.current;
          if (session.saveState.hasUnsavedChanges(project)) {
            const choice = await chooseAction(project);
            if (!choice) return;
            if (choice === "save" && (await saveSnapshot(project, session)).cancelled) return;
          }
          workspace.remove(id);
          await manageProjects?.();
        });
      } finally { pendingClose = false; }
    },
    async save() {
      if (isBusy() || pendingClose) return;
      const project = getProject();
      await locked(async () => { await flushManagedProjects?.(); await saveSnapshot(project, getWorkspace().active); });
    },
    async confirmExit() {
      if (isBusy() || pendingClose) return false;
      pendingClose = true;
      let approved = false;
      try {
        await locked(async () => {
          await flushManagedProjects?.();
          for (const session of getWorkspace().sessions) {
            const project = session.history.current;
            if (!session.saveState.hasUnsavedChanges(project)) continue;
            const choice = await chooseAction(project, { exiting: true });
            if (!choice) return;
            if (choice === "save" && (await saveSnapshot(project, session)).cancelled) return;
          }
          approved = true;
        });
        return approved;
      } finally { pendingClose = false; }
    },
    async restoreSavedState() {
      try {
        if (await marker.matches(getProject())) getWorkspace().active.saveState.markSaved(getProject());
      } catch (error) {
        showError(new Error(`旧草稿的保存状态未恢复，将在关闭前提示保存：${error.message}`, { cause: error }));
      }
    },
  };
}
