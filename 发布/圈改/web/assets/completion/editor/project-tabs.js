import { installWindowControls } from "./window-controls.js?version=20261014-borderless";

export function installProjectTabs({ document, workspace, isBusy, closeProject, newProject, renameProject, showError }) {
  const nav = document.createElement("nav");
  nav.className = "project-tabs";
  nav.setAttribute("aria-label", "已打开的项目");
  const brand = document.createElement("div");
  brand.className = "project-tabs-brand";
  brand.title = "圈改 · 把修改意见画出来";
  const brandIcon = document.createElement("img");
  brandIcon.src = "/icon.png";
  brandIcon.alt = "";
  brandIcon.width = 18;
  brandIcon.height = 18;
  brandIcon.draggable = false;
  const brandName = document.createElement("strong");
  brandName.textContent = "圈改";
  const brandCaption = document.createElement("span");
  brandCaption.className = "project-tabs-brand-caption";
  brandCaption.textContent = "· 把修改意见画出来";
  brand.append(brandIcon, brandName, brandCaption);
  const list = document.createElement("div");
  list.className = "project-tab-list";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "项目标签");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "project-tab-add";
  add.textContent = "+";
  add.title = "新建项目";
  add.setAttribute("aria-label", "新建项目");
  add.addEventListener("click", () => Promise.resolve(newProject()).catch(showError));
  nav.append(brand, list, add);
  installWindowControls({ document, titlebar: nav, bridge: window.chrome?.webview, showError });
  document.getElementById("workspace-nav").before(nav);
  document.getElementById("app").classList.add("has-project-tabs");
  const tabElements = new Map();
  let editing = null;

  function finishRename(commit) {
    if (!editing) return;
    const { id, elements } = editing;
    const title = elements.rename.value.trim();
    editing = null;
    elements.rename.hidden = true;
    elements.select.hidden = false;
    if (commit && title && !isBusy()) {
      try { renameProject(id, title); }
      catch (error) { showError(error); }
    }
  }

  function startRename(id) {
    if (isBusy()) return;
    finishRename(true);
    workspace.select(id);
    const session = workspace.sessions.find((item) => item.id === id);
    const elements = tabElements.get(id);
    if (!session || !elements) return;
    editing = { id, elements };
    elements.rename.value = session.history.current.title || "未命名修改单";
    elements.select.hidden = true;
    elements.rename.hidden = false;
    elements.rename.focus();
    elements.rename.select();
  }

  function makeTab(session) {
    const tab = document.createElement("div");
    tab.className = "project-tab";
    tab.dataset.projectId = session.id;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "project-tab-select";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-controls", "project-workspace");
    const icon = document.createElement("span");
    icon.className = "project-tab-icon";
    icon.textContent = "圈";
    const title = document.createElement("span");
    title.className = "project-tab-title";
    const index = document.createElement("span");
    index.className = "project-tab-index";
    index.setAttribute("aria-hidden", "true");
    select.append(icon, title, index);
    const rename = document.createElement("input");
    rename.type = "text";
    rename.className = "project-tab-rename";
    rename.maxLength = 200;
    rename.hidden = true;
    rename.setAttribute("aria-label", "项目名称");
    rename.title = "Enter 确认，Esc 取消";
    rename.addEventListener("blur", () => finishRename(true));
    rename.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      finishRename(event.key === "Enter");
      select.focus();
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "project-tab-close";
    close.textContent = "×";
    close.addEventListener("click", () => closeProject(session.id).catch(showError));
    select.addEventListener("click", () => { if (!isBusy()) workspace.select(session.id); });
    select.addEventListener("dblclick", () => startRename(session.id));
    select.addEventListener("keydown", (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        startRename(session.id);
        return;
      }
      const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!direction || isBusy()) return;
      event.preventDefault();
      const index = workspace.sessions.findIndex((item) => item.id === session.id);
      const next = workspace.sessions[(index + direction + workspace.sessions.length) % workspace.sessions.length];
      workspace.select(next.id);
      tabElements.get(next.id).select.focus();
    });
    tab.append(select, rename, close);
    return { tab, select, rename, title, index, close };
  }
  const panel = document.querySelector(".workspace");
  panel.id = "project-workspace";
  panel.setAttribute("role", "tabpanel");
  function render() {
    list.style.setProperty("--project-tab-count", String(workspace.sessions.length));
    const openIds = new Set(workspace.sessions.map(({ id }) => id));
    for (const [id, elements] of tabElements) {
      if (!openIds.has(id)) {
        if (editing?.id === id) finishRename(false);
        elements.tab.remove();
        tabElements.delete(id);
      }
    }
    for (const [index, session] of workspace.sessions.entries()) {
      let elements = tabElements.get(session.id);
      if (!elements) {
        elements = makeTab(session);
        tabElements.set(session.id, elements);
        list.append(elements.tab);
      }
      const active = session.id === workspace.active?.id;
      const title = session.history.current.title || "未命名修改单";
      const dirty = session.saveState.hasUnsavedChanges(session.history.current);
      elements.title.textContent = title;
      elements.index.textContent = String(index + 1);
      elements.tab.classList.toggle("active", active);
      elements.select.id = `project-tab-${session.id}`;
      elements.select.title = `${title}${dirty ? " · 未保存" : ""} · 双击改名`;
      elements.select.setAttribute("aria-label", elements.select.title);
      elements.select.setAttribute("aria-selected", String(active));
      elements.select.tabIndex = active ? 0 : -1;
      elements.select.disabled = isBusy();
      elements.rename.disabled = isBusy();
      elements.close.disabled = isBusy();
      elements.close.title = `关闭 ${title}`;
      elements.close.setAttribute("aria-label", `关闭项目：${title}`);
      if (active) panel.setAttribute("aria-labelledby", elements.select.id);
    }
    add.disabled = isBusy();
  }
  render();
  return { render };
}
