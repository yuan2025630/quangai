function icon(paths) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function installWorkspaceControls({ document }) {
  const workspace = document.querySelector('.workspace');
  const actions = document.querySelector('.file-actions');
  const menu = document.createElement('div');
  menu.id = 'workspace-more-menu';
  menu.className = 'workspace-more-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('aria-label', '更多项目操作');
  for (const id of ['open-project', 'wallpaper-button']) menu.append(document.getElementById(id));
  document.body.append(menu);
  const more = document.createElement('button');
  more.id = 'workspace-more';
  more.type = 'button';
  more.className = 'text-button workspace-more';
  more.setAttribute('popovertarget', menu.id);
  more.innerHTML = `更多${icon('<path d="m6 9 6 6 6-6"/>')}`;
  actions.insertBefore(more, document.getElementById('complete-project'));
  document.getElementById('project-library-button').textContent = '项目库';
  const exportButton = document.getElementById('export');
  exportButton.append(document.createTextNode('修改包'));

  menu.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const bounds = more.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(bounds.right - 200, document.defaultView.innerWidth - 208))}px`;
    menu.style.top = `${bounds.bottom + 6}px`;
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('button')) menu.hidePopover();
  });

  const focus = document.createElement('button');
  focus.id = 'focus-canvas';
  focus.type = 'button';
  focus.className = 'text-button workspace-focus';
  focus.title = '专注画布，暂时隐藏两侧面板（F8）';
  focus.setAttribute('aria-pressed', 'false');
  focus.innerHTML = `${icon('<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>')}<span>专注</span>`;
  document.querySelector('.canvas-actions').append(focus);
  let previousSelection = null;
  let previousCount = 0;

  function setFocused(value) {
    const focusedPanel = document.activeElement?.closest('.notes-panel, .tool-rail');
    workspace.classList.toggle('is-canvas-focused', value);
    focus.setAttribute('aria-pressed', String(value));
    focus.querySelector('span').textContent = value ? '显示面板' : '专注';
    focus.title = value ? '显示工具和意见面板（F8）' : '专注画布，暂时隐藏两侧面板（F8）';
    if (value && focusedPanel) document.getElementById('canvas-viewport').focus({ preventScroll: true });
    document.defaultView.dispatchEvent(new Event('resize'));
  }

  focus.addEventListener('click', () => setFocused(!workspace.classList.contains('is-canvas-focused')));
  document.addEventListener('keydown', event => {
    if (event.key !== 'F8' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault();
    focus.click();
  });

  return {
    reveal() {
      if (workspace.classList.contains('is-canvas-focused')) setFocused(false);
    },
    render(project, selectedId) {
      // New selections and newly drawn notes need their editor to stay reachable.
      if (workspace.classList.contains('is-canvas-focused') &&
          ((selectedId && selectedId !== previousSelection) || project.annotations.length > previousCount)) {
        setFocused(false);
      }
      previousSelection = selectedId;
      previousCount = project.annotations.length;
    }
  };
}
