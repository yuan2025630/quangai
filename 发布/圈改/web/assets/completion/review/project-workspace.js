import { createProjectSaveState } from "./project-save-state.js?version=0.1.11";

/** Each open project owns its undo history, view, and saved-file snapshot. */
export function createProjectWorkspace({ emptyProject, createHistory, makeId, captureView, activate, changed }) {
  let sessions = [];
  let activeId = null;
  function makeSession(project, id = makeId(), view = null, saved = null) {
    const saveState = createProjectSaveState(emptyProject);
    saveState.restore(saved);
    return { id, history: createHistory(project), view, saveState };
  }
  function captureActive() {
    const active = sessions.find((session) => session.id === activeId);
    if (active) active.view = captureView();
  }
  function select(id) {
    const next = sessions.find((session) => session.id === id);
    if (!next || next.id === activeId) return;
    captureActive();
    activeId = next.id;
    activate(next);
    changed();
  }
  return {
    get sessions() { return sessions; },
    get active() { return sessions.find((session) => session.id === activeId); },
    select,
    add(project = emptyProject(), { saved = false } = {}) {
      captureActive();
      const session = makeSession(project);
      if (saved) session.saveState.markSaved(project);
      sessions.push(session);
      activeId = session.id;
      activate(session);
      changed();
      return session;
    },
    remove(id) {
      const index = sessions.findIndex((session) => session.id === id);
      if (index < 0) return;
      const wasActive = id === activeId;
      sessions.splice(index, 1);
      if (!sessions.length) {
        this.add();
        return;
      }
      if (wasActive) {
        const next = sessions[Math.min(index, sessions.length - 1)];
        activeId = next.id;
        activate(next);
      }
      changed();
    },
    snapshot() {
      captureActive();
      return {
        workspaceVersion: 1,
        activeId,
        tabs: sessions.map(({ id, history, view, saveState }) => ({
          id, project: history.current, view, saved: saveState.snapshot(),
        })),
      };
    },
    restore(tabs, restoredActiveId) {
      if (!tabs.length) throw new Error("本机工作区没有可恢复的项目。");
      sessions = tabs.map(({ project, id, view, saved }) => makeSession(project, id, view, saved));
      const active = sessions.find((session) => session.id === restoredActiveId) ?? sessions[0];
      activeId = active.id;
      activate(active);
      changed();
    },
  };
}
