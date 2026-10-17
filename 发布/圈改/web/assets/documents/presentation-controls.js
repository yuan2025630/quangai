import { importPresentation, importRevisedPresentation, promoteRevisedPresentation, selectPresentationPage, syncPresentationProject } from './presentation-project.js?version=20261013-projects';
import { presentationAgentPrompt } from './presentation-instructions.js?version=20261017-ppt-preview-final';
import { installPresentationThumbnails } from './presentation-thumbnails.js?version=20261017-memory';

export function installPresentationControls({ request, library, getProject, isBusy, commitProject, setView, setEditorState, render, persist, notify }) {
  const navigation = document.createElement('section');
  navigation.id = 'presentation-navigation'; navigation.className = 'presentation-navigation'; navigation.hidden = true;
  navigation.setAttribute('aria-label', 'PPT 页面导航');
  navigation.innerHTML = `<div class="presentation-heading"><strong id="presentation-name"></strong><span id="presentation-position"></span><span id="presentation-pending-count"></span><label class="presentation-jump" for="presentation-page-number">跳到第 <input id="presentation-page-number" type="number" min="1" step="1" required aria-label="跳转到 PPT 页码"> 页</label><button class="text-button presentation-jump-button" id="presentation-jump">跳转</button><label class="presentation-filter"><input id="presentation-only-changes" type="checkbox">仅看待修改页</label><button class="text-button" id="presentation-previous" aria-label="上一页 PPT">‹</button><button class="text-button" id="presentation-next" aria-label="下一页 PPT">›</button></div><p id="presentation-navigation-status" class="presentation-navigation-status" role="status" hidden>暂无待修改页。取消筛选可查看全部页面。</p><div id="presentation-pages" class="presentation-pages" role="tablist" aria-label="PPT 页码"></div>`;
  document.getElementById('canvas-viewport').before(navigation);
  const previewToolbar = document.createElement('div');
  previewToolbar.className = 'presentation-preview-toolbar';
  previewToolbar.innerHTML = `<div class="presentation-preview-modes" role="group" aria-label="PPT 预览方式"><button type="button" class="text-button" data-preview-mode="strip" aria-controls="presentation-pages">单行预览</button><button type="button" class="text-button" data-preview-mode="all" aria-controls="presentation-pages">预览全部</button><button type="button" class="text-button" data-preview-mode="collapsed" aria-controls="presentation-pages">收起预览</button></div><label class="presentation-preview-size" for="presentation-preview-size">预览大小 <input id="presentation-preview-size" type="range" min="80" max="220" step="20" value="120"><output id="presentation-preview-size-value" for="presentation-preview-size">120</output></label>`;
  navigation.querySelector('.presentation-heading').after(previewToolbar);
  const details = document.createElement('div');
  details.id = 'presentation-preview-details'; details.className = 'presentation-preview-details';
  details.append(...navigation.childNodes);
  const expand = document.createElement('button');
  expand.type = 'button'; expand.id = 'presentation-expand'; expand.className = 'text-button presentation-expand';
  expand.textContent = '展开预览'; expand.setAttribute('aria-controls', details.id); expand.setAttribute('aria-expanded', 'false');
  navigation.append(expand, details);
  const pagesElement = document.getElementById('presentation-pages');
  const thumbnails = installPresentationThumbnails(pagesElement, notify);
  const sizeInput = document.getElementById('presentation-preview-size');
  const previewModes = ['strip', 'all', 'collapsed'];
  let previewMode = 'strip', previewSize = 120;
  let expandedMode = 'strip';
  try {
    const saved = JSON.parse(localStorage.getItem('quangai.presentation-preview') || 'null');
    if (previewModes.includes(saved?.mode)) previewMode = saved.mode;
    if (['strip', 'all'].includes(saved?.expandedMode)) expandedMode = saved.expandedMode;
    else if (previewMode !== 'collapsed') expandedMode = previewMode;
    if (Number.isInteger(saved?.size) && saved.size >= 80 && saved.size <= 220 && saved.size % 20 === 0) previewSize = saved.size;
  } catch { /* Invalid or unavailable preferences use the default view. */ }
  let lastVisiblePage = null;
  let revealFrame = null;

  function revealActivePage() {
    if (revealFrame !== null) cancelAnimationFrame(revealFrame);
    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      const selected = pagesElement.querySelector('[aria-selected="true"]:not([hidden])');
      if (!selected || pagesElement.hidden || navigation.hidden) return;
      const bounds = pagesElement.getBoundingClientRect(), active = selected.getBoundingClientRect();
      if (active.left < bounds.left) pagesElement.scrollLeft -= bounds.left - active.left;
      else if (active.right > bounds.right) pagesElement.scrollLeft += active.right - bounds.right;
      if (active.top < bounds.top) pagesElement.scrollTop -= bounds.top - active.top;
      else if (active.bottom > bounds.bottom) pagesElement.scrollTop += active.bottom - bounds.bottom;
    });
  }
  function renderPreview() {
    const collapsed = previewMode === 'collapsed';
    const hadFocus = navigation.contains(document.activeElement);
    navigation.dataset.previewMode = previewMode;
    navigation.style.setProperty('--presentation-preview-width', `${previewSize}px`);
    details.hidden = collapsed;
    expand.hidden = !collapsed;
    expand.setAttribute('aria-expanded', String(!collapsed));
    pagesElement.hidden = collapsed;
    thumbnails.setVisible(!collapsed && !navigation.hidden);
    previewToolbar.querySelector('.presentation-preview-size').hidden = pagesElement.hidden;
    sizeInput.value = previewSize;
    document.getElementById('presentation-preview-size-value').value = previewSize;
    previewToolbar.querySelectorAll('[data-preview-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.previewMode === previewMode));
      button.setAttribute('aria-controls', details.id);
      button.setAttribute('aria-expanded', String(!collapsed));
    });
    if (hadFocus && collapsed) expand.focus({ preventScroll: true });
    revealActivePage();
    window.dispatchEvent(new Event('resize'));
  }
  function savePreview() {
    try { localStorage.setItem('quangai.presentation-preview', JSON.stringify({ mode: previewMode, size: previewSize, expandedMode })); }
    catch { /* The view still works when preference storage is unavailable. */ }
  }
  previewToolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-preview-mode]');
    if (!button) return;
    previewMode = button.dataset.previewMode;
    if (previewMode !== 'collapsed') expandedMode = previewMode;
    renderPreview(); savePreview();
  });
  expand.addEventListener('click', () => {
    previewMode = expandedMode; renderPreview(); savePreview();
    previewToolbar.querySelector(`[data-preview-mode="${previewMode}"]`).focus({ preventScroll: true });
  });
  sizeInput.addEventListener('input', () => { previewSize = sizeInput.valueAsNumber; renderPreview(); savePreview(); });
  renderPreview();
  let lastImages = null;
  let lastDeckId = null;
  const needsChange = page => page.annotations.some(note => ['change', 'move'].includes(note.kind) && ['pending', 'changes'].includes(note.status));

  function activate(number) {
    if (isBusy()) return;
    const project = selectPresentationPage(getProject(), number);
    setView(project); setEditorState({ source: 'original', selectedId: null, originalTargetId: null, zoom: null, draft: null, difference: null, imageHidden: false });
    render(); persist();
  }
  function navigablePages() {
    const pages = syncPresentationProject(getProject()).presentation?.pages ?? [];
    return document.getElementById('presentation-only-changes').checked ? pages.filter(needsChange) : pages;
  }
  function movePage(direction) {
    const current = getProject().presentation.activePage;
    const pages = navigablePages();
    const next = direction > 0 ? pages.find(page => page.number > current) : pages.filter(page => page.number < current).at(-1);
    if (next) activate(next.number);
  }
  function jumpToPage() {
    const input = document.getElementById('presentation-page-number');
    if (isBusy() || !input.reportValidity()) return;
    const number = input.valueAsNumber;
    const page = syncPresentationProject(getProject()).presentation.pages.find(page => page.number === number);
    if (!page) return;
    if (!needsChange(page)) document.getElementById('presentation-only-changes').checked = false;
    activate(number);
  }
  function renderNavigation() {
    const project = getProject(), deck = project.presentation;
    navigation.hidden = !deck;
    document.getElementById('image-input').accept = 'image/*,.ppt,.pptx';
    if (!deck) {
      thumbnails.setVisible(false); thumbnails.reset(); pagesElement.replaceChildren();
      document.querySelectorAll('[name="export-mode"]').forEach(input => { input.disabled = isBusy(); });
      if (lastImages) {
        let previous = 'project';
        try { previous = localStorage.getItem('quangai.export-mode') || previous; } catch {}
        document.querySelectorAll('[name="export-mode"]').forEach(input => { input.disabled = isBusy(); input.checked = input.value === previous; });
        document.querySelector('.agent-export h3 + p').textContent = '直接导出本地目录，完成后自动载入修改稿。';
      }
      lastImages = null; lastDeckId = null; lastVisiblePage = null; return;
    }
    const deckId = `${project.storageId}:${deck.assetId}`;
    if (lastDeckId !== deckId) {
      document.getElementById('presentation-only-changes').checked = false;
      lastImages = null; lastDeckId = deckId; lastVisiblePage = null;
    }
    const current = syncPresentationProject(project).presentation;
    const modeOptions = document.querySelectorAll('[name="export-mode"]');
    modeOptions.forEach(input => { input.disabled = true; input.checked = input.value === 'project'; });
    document.querySelector('.agent-export h3 + p').textContent = '导出可编辑 PPT 和指定页意见，完成后导入修改后的 PPT 核对。';
    document.getElementById('presentation-name').textContent = current.fileName;
    document.getElementById('presentation-position').textContent = `第 ${current.activePage} / ${current.pages.length} 页`;
    const onlyChanges = document.getElementById('presentation-only-changes').checked;
    const pendingPages = current.pages.filter(needsChange), available = onlyChanges ? pendingPages : current.pages;
    document.getElementById('presentation-pending-count').textContent = `待修改 ${pendingPages.length} 页`;
    document.getElementById('presentation-previous').disabled = isBusy() || !available.some(page => page.number < current.activePage);
    document.getElementById('presentation-next').disabled = isBusy() || !available.some(page => page.number > current.activePage);
    document.getElementById('presentation-navigation-status').hidden = !onlyChanges || pendingPages.length > 0;
    const pageNumber = document.getElementById('presentation-page-number');
    pageNumber.max = current.pages.length; pageNumber.disabled = isBusy();
    if (document.activeElement !== pageNumber) pageNumber.value = current.activePage;
    document.getElementById('presentation-jump').disabled = isBusy();
    const images = current.pages.map(page => page.images.original);
    if (!lastImages || images.some((image, index) => image !== lastImages[index]) || pagesElement.children.length !== current.pages.length) {
      thumbnails.reset(); pagesElement.replaceChildren();
      for (const page of current.pages) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'presentation-page';
        button.dataset.page = page.number; button.setAttribute('role', 'tab');
        const image = document.createElement('img'); image.alt = ''; image.decoding = 'async';
        const label = document.createElement('span'); label.className = 'presentation-page-label';
        button.append(image, label); pagesElement.append(button);
      }
      lastImages = images;
      thumbnails.reset(images);
    }
    thumbnails.setVisible(previewMode !== 'collapsed');
    const activePageVisible = available.some(page => page.number === current.activePage);
    let focusAssigned = false;
    for (const [index, page] of current.pages.entries()) {
      const button = pagesElement.children[index];
      const pending = needsChange(page), selected = current.activePage === page.number;
      button.hidden = onlyChanges && !pending; button.disabled = isBusy();
      button.classList.toggle('has-changes', pending);
      button.setAttribute('aria-selected', String(selected));
      const focusable = !button.hidden && (selected || !activePageVisible && !focusAssigned);
      button.tabIndex = focusable ? 0 : -1;
      focusAssigned ||= focusable;
      button.setAttribute('aria-label', `第 ${page.number} 页，${page.title}，${page.annotations.length} 条标注${pending ? '，待修改' : ''}`);
      button.title = `第 ${page.number} 页 · ${page.title} · 页面 ID ${page.slideId}`;
      button.querySelector('span').textContent = `${page.number}${pending ? ' · 待修改' : page.annotations.length ? ` · ${page.annotations.length} 条` : ''}`;
    }
    const visiblePage = `${deckId}:${current.activePage}:${onlyChanges}`;
    if (visiblePage !== lastVisiblePage) { lastVisiblePage = visiblePage; revealActivePage(); }
    document.getElementById('canvas-image').alt = `PPT 第 ${current.activePage} 页`;
    document.getElementById('agent-export-status').textContent = deck.exportFolder
      ? '本轮目录已就绪，复制提示词交接。修改意见后请重新导出，完成后导入完整修改 PPT。'
      : '先导出协作目录或 ZIP 修改包，再交给协作者；完成后导入完整修改 PPT。';
    document.getElementById('export-agent').disabled = isBusy();
    document.getElementById('agent-details').hidden = !deck.exportFolder;
    document.getElementById('agent-folder').value = deck.exportFolder ?? '';
    document.getElementById('agent-prompt').value = deck.exportFolder ? presentationAgentPrompt(project, deck.exportFolder) : '';
    document.getElementById('copy-agent-prompt').disabled = isBusy() || !deck.exportFolder;
    document.getElementById('open-agent-folder').disabled = isBusy() || !deck.exportFolder;
  }
  async function importFile(file, role) {
    const managed = await library.adopt(getProject());
    if (managed.storageId !== getProject().storageId) setView(managed);
    if (role === 'reference') throw new Error('参考图请使用图片文件；PPT 从“导入文件”入口导入。');
    if (role === 'revised' && !getProject().presentation) throw new Error('先导入原 PPT，再导入修改后的 PPT。');
    if (role === 'original' && getProject().images.original && !confirm('导入新的 PPT 将替换当前文件及其标注，可以撤销。是否继续？')) return;
    const result = await request('presentation-import', { id: managed.storageId }, file);
    const next = role === 'revised' ? importRevisedPresentation(getProject(), result) : importPresentation(getProject(), result);
    setEditorState({ mode: role === 'revised' ? 'review' : 'edit', source: 'original', tool: 'select', selectedId: null,
      originalTargetId: null, zoom: null, draft: null, difference: null, imageHidden: false });
    commitProject(next, { affectsDifference: true });
    await library.flush(); notify(role === 'revised' ? '修改后的 PPT 已按页面 ID 配对，可逐页核对。' : `PPT 已导入，共 ${result.pages.length} 页。`);
  }
  pagesElement.addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (button) activate(Number(button.dataset.page)); });
  pagesElement.addEventListener('keydown', event => {
    const buttons = [...pagesElement.querySelectorAll('button:not([hidden])')], current = buttons.indexOf(document.activeElement);
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const columns = previewMode === 'all' && buttons.length ? buttons.filter(button => button.offsetTop === buttons[0].offsetTop).length : 1;
    const step = ['ArrowUp', 'ArrowDown'].includes(event.key) ? columns : 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -step : step)));
    if (buttons[index]) { activate(Number(buttons[index].dataset.page)); buttons[index].focus(); }
  });
  document.getElementById('presentation-only-changes').addEventListener('change', () => {
    const pages = navigablePages();
    if (pages.length && !pages.some(page => page.number === getProject().presentation.activePage)) activate(pages[0].number);
    else renderNavigation();
  });
  document.getElementById('presentation-previous').addEventListener('click', () => movePage(-1));
  document.getElementById('presentation-next').addEventListener('click', () => movePage(1));
  document.getElementById('presentation-jump').addEventListener('click', jumpToPage);
  document.getElementById('presentation-page-number').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); jumpToPage(); }
  });
  document.getElementById('use-revised').addEventListener('click', event => {
    if (!getProject().presentation) return;
    event.stopImmediatePropagation();
    if (isBusy()) return;
    try {
      const project = promoteRevisedPresentation(getProject());
      setEditorState({ source: 'original', selectedId: null, zoom: null, draft: null, difference: null });
      commitProject(project, { affectsDifference: true });
      notify('完整修改稿已成为 PPT 原稿，所有页同步更新，可撤销。');
    } catch (error) { notify(error.message); }
  }, true);
  return { render: renderNavigation, importFile, activate };
}
