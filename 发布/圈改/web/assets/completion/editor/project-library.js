export function installProjectLibrary({ request, workspace, parseProject, emptyProject, isBusy, runBusy, render, persist, notify, showError, pickLegacyProject }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'project-library-dialog';
  dialog.className = 'project-library-dialog';
  dialog.setAttribute('aria-labelledby', 'project-library-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">统一保管</span><h2 id="project-library-title">所有项目</h2></div><button class="icon-button" data-library-close aria-label="关闭项目管理">×</button></div>
    <p class="project-library-root" id="project-library-root"></p><p class="project-library-hint">项目、导入文件副本、各页标注与导出文件集中保存在这里。删除会移入项目回收站。</p>
    <div class="project-library-actions"><button class="button subtle" data-library-action="open-root">打开总文件夹</button><button class="button subtle" data-library-action="change-root">更换并迁移全部项目</button><button class="button subtle" data-library-action="open-trash">打开回收站</button><button class="button subtle" data-library-action="refresh">刷新</button></div>
    <div class="project-library-filters"><label class="project-library-search" for="project-library-search">搜索项目<input id="project-library-search" type="search" placeholder="输入项目名称" autocomplete="off" aria-controls="project-library-list"></label><label class="project-library-type" for="project-library-type">项目类型<select id="project-library-type" aria-controls="project-library-list"><option value="all">全部类型</option><option value="image">图片项目</option><option value="ppt">PPT 项目</option></select></label><button class="button subtle" id="project-library-clear-filters" hidden>清除筛选</button></div>
    <p id="project-library-count" class="project-library-count" role="status" aria-live="polite" aria-atomic="true"></p>
    <div id="project-library-list" class="project-library-list" aria-describedby="project-library-count"></div>
    <div class="dialog-actions"><button class="button subtle" id="library-import-project">导入旧项目文件</button><button class="button primary" id="library-new-project">新建项目</button></div>`;
  document.body.append(dialog);
  const button = document.createElement('button');
  button.id = 'project-library-button'; button.className = 'text-button'; button.textContent = '项目管理';
  document.getElementById('open-project').after(button);
  const known = new Set();
  const timers = new Map();
  const saving = new Map();
  const savedMetadata = new Map();
  const rows = new Map();
  const list = dialog.querySelector('#project-library-list');
  const search = dialog.querySelector('#project-library-search');
  const type = dialog.querySelector('#project-library-type');
  const clearFiltersButton = dialog.querySelector('#project-library-clear-filters');
  const count = dialog.querySelector('#project-library-count');
  const emptyState = document.createElement('p'); emptyState.className = 'project-library-empty'; list.append(emptyState);
  let root = '', entries = [];

  function filterList() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const row of rows.values()) {
      row.hidden = !row.dataset.projectTitle.includes(query) || (type.value !== 'all' && row.dataset.projectType !== type.value);
      if (!row.hidden) matches++;
    }
    count.textContent = `显示 ${matches} / ${entries.length} 个项目`;
    clearFiltersButton.hidden = !query && type.value === 'all';
    emptyState.hidden = matches > 0;
    emptyState.textContent = entries.length ? '没有符合当前搜索或类型的项目。请调整条件，或点击“清除筛选”查看全部项目。' : '还没有项目。新建或导入文件后会保存在这里。';
  }
  function clearFilters() { search.value = ''; type.value = 'all'; filterList(); }
  function renderList() {
    document.getElementById('project-library-root').textContent = root;
    const ids = new Set(entries.map(entry => entry.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    let next = list.firstElementChild;
    for (const entry of entries) {
      let row = rows.get(entry.id);
      if (!row) {
        row = document.createElement('article'); row.className = 'project-library-row'; row.dataset.projectId = entry.id;
        const summary = document.createElement('div'); summary.append(document.createElement('strong'), document.createElement('span')); row.append(summary);
        for (const [action, label] of [['read', '打开'], ['open', '文件夹'], ['trash', '删除']]) {
          const control = document.createElement('button'); control.className = 'button subtle'; control.dataset.projectAction = action; control.textContent = label; row.append(control);
        }
        rows.set(entry.id, row);
      }
      row.querySelector('strong').textContent = entry.title;
      row.querySelector('span').textContent = `${entry.pages ? `PPT · ${entry.pages} 页` : '图片项目'} · ${new Date(entry.updatedAt).toLocaleString()}`;
      row.dataset.projectTitle = entry.title.toLocaleLowerCase(); row.dataset.projectType = entry.pages ? 'ppt' : 'image';
      for (const control of row.querySelectorAll('[data-project-action]')) control.setAttribute('aria-label', `${control.textContent} ${entry.title}`);
      if (row !== next) list.insertBefore(row, next);
      next = row.nextElementSibling;
    }
    filterList();
  }
  async function refresh() {
    const result = await request('list'); root = result.root; entries = result.projects;
    known.clear(); entries.forEach(entry => known.add(entry.id)); renderList();
  }
  async function adopt(project, file = null) {
    if (!file && project.storageId && known.has(project.storageId)) return project;
    const result = await request(file ? 'adopt' : 'create', { projectJson: JSON.stringify(project) }, file);
    const managed = parseProject(JSON.parse(result.projectJson)); known.add(managed.storageId);
    return managed;
  }
  async function saveSession(session) {
    const project = session.history.current;
    if (!project.storageId || !known.has(project.storageId)) return;
    const id = project.storageId;
    const metadata = JSON.stringify([project.completedAt ?? null, project.presentation?.activePage ?? null, project.presentation?.exportFolder ?? null]);
    if (!session.saveState.hasUnsavedChanges(project) && savedMetadata.get(id) === metadata) return;
    const previous = saving.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (!known.has(id)) return;
      await request('save', { id, projectJson: JSON.stringify(project) });
      savedMetadata.set(id, metadata);
      session.saveState.markSaved(project); render(); persist();
    }).catch(error => { throw new Error(`项目未能自动保存到统一文件夹：${error.message}`, { cause: error }); });
    saving.set(id, operation);
    try { await operation; }
    finally { if (saving.get(id) === operation) saving.delete(id); }
  }
  function schedule() {
    for (const session of workspace.sessions) {
      const id = session.history.current.storageId;
      if (!id || !known.has(id) || !session.saveState.hasUnsavedChanges(session.history.current)) continue;
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => { timers.delete(id); saveSession(session).catch(showError); }, 800));
    }
  }
  async function flush() {
    timers.forEach(clearTimeout); timers.clear();
    for (const session of workspace.sessions) await saveSession(session);
    await Promise.all([...saving.values()]);
  }
  async function manageWorkspace() {
    for (const session of workspace.sessions) {
      const original = session.history.current;
      const managed = await adopt(original);
      session.history.bindStorage(managed.storageId);
      await saveSession(session);
    }
    persist();
  }
  async function newProject() {
    const project = await adopt(emptyProject()); workspace.add(project, { saved: true }); persist();
    clearFilters();
    notify('新项目已创建在统一项目文件夹。'); return project;
  }
  async function show() { if (isBusy()) return; await flush(); await refresh(); dialog.showModal(); }
  search.addEventListener('input', filterList);
  type.addEventListener('change', filterList);
  clearFiltersButton.addEventListener('click', () => { clearFilters(); search.focus(); });
  button.addEventListener('click', () => show().catch(showError));
  document.getElementById('open-project').addEventListener('click', event => { event.stopImmediatePropagation(); show().catch(showError); }, true);
  dialog.querySelector('[data-library-close]').addEventListener('click', () => dialog.close());
  document.getElementById('library-import-project').addEventListener('click', () => {
    dialog.close(); pickLegacyProject();
  });
  document.getElementById('library-new-project').addEventListener('click', () => {
    dialog.close(); runBusy(newProject).catch(showError);
  });
  dialog.addEventListener('click', event => {
    const control = event.target.closest('[data-library-action],[data-project-action]'); if (!control || isBusy()) return;
    const action = control.dataset.libraryAction ?? control.dataset.projectAction;
    const id = control.closest('[data-project-id]')?.dataset.projectId;
    if (action === 'trash' && !confirm('将整个项目及其中的文件副本、标注和导出移到项目回收站？')) return;
    runBusy(async () => {
      if (action === 'refresh') await refresh();
      else if (action === 'read') {
        const open = workspace.sessions.find(session => session.history.current.storageId === id);
        if (open) workspace.select(open.id);
        else { const result = await request('read', { id }); workspace.add(parseProject(JSON.parse(result.projectJson)), { saved: true }); }
        persist(); dialog.close();
      } else if (action === 'trash') {
        clearTimeout(timers.get(id)); timers.delete(id); await saving.get(id); await request('trash', { id }); known.delete(id); savedMetadata.delete(id);
        for (const session of [...workspace.sessions]) if (session.history.current.storageId === id) workspace.remove(session.id);
        await manageWorkspace(); await refresh(); notify('项目已移到回收站。');
      } else if (action === 'change-root') { await flush(); const result = await request(action); if (!result.cancelled) { await refresh(); notify('全部项目已迁移到新文件夹，原位置保留迁移备份。'); } }
      else await request(action, id ? { id } : {});
    }).catch(showError);
  });
  const ready = refresh();
  return { ready, adopt, manageWorkspace, newProject, schedule, flush, show, refresh, get root() { return root; } };
}
