export function installNoteFilters({ document, statusLabels, kindLabels }) {
  const list = document.getElementById('notes-list');
  const filters = document.createElement('section');
  filters.className = 'note-filters';
  filters.setAttribute('aria-label', '筛选当前页意见');
  filters.innerHTML = `<div class="note-filter-fields">
    <input id="note-search" type="search" placeholder="搜索意见、编号…" aria-label="搜索当前页意见" aria-controls="notes-list" autocomplete="off">
    <select id="note-status-filter" aria-label="按核对状态筛选" aria-controls="notes-list"><option value="all">全部状态</option></select>
    </div><div class="note-filter-summary"><span id="note-filter-count" role="status" aria-live="polite" aria-atomic="true"></span><button id="clear-note-filters" class="note-filter-clear" type="button" hidden>清除筛选</button></div>`;
  list.before(filters);
  const search = filters.querySelector('#note-search');
  const status = filters.querySelector('#note-status-filter');
  const count = filters.querySelector('#note-filter-count');
  const clear = filters.querySelector('#clear-note-filters');
  for (const [value, label] of Object.entries(statusLabels)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    status.append(option);
  }
  const empty = document.createElement('div');
  empty.className = 'note-filter-empty';
  empty.hidden = true;
  empty.innerHTML = '<strong>没有符合条件的意见</strong><p>换个关键词，或清除筛选查看全部意见。</p><button type="button" class="text-button">清除筛选</button>';
  list.after(empty);
  let currentProject = null;
  let previousSelection = null;

  function matches(note) {
    const query = search.value.trim().toLocaleLowerCase();
    const content = `${note.number} ${note.comment} ${kindLabels[note.kind] ?? ''} ${statusLabels[note.status] ?? ''}`.toLocaleLowerCase();
    return (status.value === 'all' || note.status === status.value) && content.includes(query);
  }

  function applyFilters() {
    if (!currentProject) return;
    const notes = new Map(currentProject.annotations.map(note => [note.id, note]));
    let visible = 0;
    for (const card of list.querySelectorAll('[data-note]')) {
      const note = notes.get(card.dataset.note);
      card.hidden = !note || !matches(note);
      if (!card.hidden) visible++;
    }
    const total = notes.size;
    const satisfied = currentProject.annotations.filter(note => note.status === 'accepted').length;
    const filtered = Boolean(search.value.trim()) || status.value !== 'all';
    filters.hidden = total === 0;
    clear.hidden = !filtered;
    empty.hidden = total === 0 || visible > 0;
    list.hidden = !empty.hidden;
    count.textContent = filtered ? `显示 ${visible} / ${total} 条意见` : `本页 ${total} 条意见 · ${satisfied} 条已满意`;
  }

  function clearFilters() {
    search.value = '';
    status.value = 'all';
    applyFilters();
  }

  search.addEventListener('input', applyFilters);
  status.addEventListener('change', applyFilters);
  clear.addEventListener('click', () => { clearFilters(); search.focus(); });
  empty.querySelector('button').addEventListener('click', () => { clearFilters(); search.focus(); });

  return {
    reveal(note) {
      if (note && !matches(note)) clearFilters();
    },
    render(project, selectedId) {
      const selected = project.annotations.find(note => note.id === selectedId);
      // Selecting a pin on the canvas must also reveal it in a filtered list.
      if (currentProject?.storageId !== project.storageId ||
          (selected && selectedId !== previousSelection && !matches(selected))) {
        search.value = '';
        status.value = 'all';
      }
      currentProject = project;
      previousSelection = selectedId;
      applyFilters();
    }
  };
}
