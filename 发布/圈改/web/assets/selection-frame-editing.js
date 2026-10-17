const handlePositions = [
  ['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5],
  ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5],
];
const svgNamespace = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function containsPoint(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}

function resizedRect(rect, direction, start, point, image) {
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  const minWidth = Math.min(rect.width, 5 / image.width);
  const minHeight = Math.min(rect.height, 5 / image.height);
  const dx = point.x - start.x, dy = point.y - start.y;
  if (direction.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (direction.includes('e')) right = clamp(right + dx, left + minWidth, 1);
  if (direction.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
  if (direction.includes('s')) bottom = clamp(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function movedNote(note, start, point) {
  const rect = note.rect;
  const xs = note.arrow ? [rect.x, rect.x + rect.width, note.arrow.start.x, note.arrow.end.x] : [rect.x, rect.x + rect.width];
  const ys = note.arrow ? [rect.y, rect.y + rect.height, note.arrow.start.y, note.arrow.end.y] : [rect.y, rect.y + rect.height];
  const dx = clamp(point.x - start.x, -Math.min(...xs), 1 - Math.max(...xs));
  const dy = clamp(point.y - start.y, -Math.min(...ys), 1 - Math.max(...ys));
  return {
    ...note, rect: { ...rect, x: rect.x + dx, y: rect.y + dy },
    ...(note.arrow ? { arrow: {
      start: { x: note.arrow.start.x + dx, y: note.arrow.start.y + dy },
      end: { x: note.arrow.end.x + dx, y: note.arrow.end.y + dy },
    } } : {}),
  };
}

/** Existing frames remain editable regardless of the current drawing tool. */
export function installSelectionFrameEditing({ overlay, viewport, getState, selectNote, commitNote, deleteNote, showDraft, clearDraft }) {
  let resizeId = null, drag = null, lastTap = null, draftFrame = null;
  const win = document.defaultView;

  function eligible() {
    const state = getState();
    return !state.busy && !state.imageHidden && state.mode === 'edit' && state.project.images[state.source];
  }

  function point(event) {
    const bounds = overlay.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function noteAt(event) {
    const state = getState();
    const position = point(event);
    const targetId = event.target.closest('[data-note-id]')?.dataset.noteId;
    const notes = state.project.annotations.filter(note => note.source === state.source);
    const target = notes.find(note => note.id === targetId);
    if (target) return target;
    return [...notes].reverse().find(note => containsPoint(note.rect, position));
  }

  function cancelDrag() {
    if (!drag) return;
    const pointerId = drag.pointerId;
    const hadDraft = !!drag.next;
    drag = null;
    if (draftFrame !== null) win.cancelAnimationFrame(draftFrame);
    draftFrame = null;
    overlay.classList.remove('is-adjusting-selection');
    if (overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
    if (hadDraft) clearDraft();
  }

  function renderHandles() {
    overlay.querySelectorAll('[data-handle], [data-selection-handles]').forEach(handle => handle.remove());
    const state = getState();
    if (drag && (!eligible() || state.project !== drag.project || state.selectedId !== drag.note.id || state.project.images[state.source] !== drag.image)) cancelDrag();
    const note = state.draft?.id === resizeId ? state.draft : state.project.annotations.find(note => note.id === resizeId);
    if (!eligible() || !note || note.arrow || state.selectedId !== resizeId || note.source !== state.source) {
      resizeId = null;
      if (drag && (!eligible() || state.selectedId !== drag.note.id || state.project.images[state.source] !== drag.image)) cancelDrag();
      return;
    }
    const image = state.project.images[state.source];
    const bounds = overlay.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const group = document.createElementNS(svgNamespace, 'g');
    group.dataset.selectionHandles = resizeId;
    group.dataset.noteId = resizeId;
    group.setAttribute('aria-label', '拖动八个手柄调整圈选范围');
    for (const [direction, x, y] of handlePositions) {
      const handle = document.createElementNS(svgNamespace, 'rect');
      const width = 11 * image.width / bounds.width, height = 11 * image.height / bounds.height;
      handle.dataset.resizeDirection = direction;
      handle.setAttribute('class', `selection-resize-handle selection-resize-${direction}`);
      handle.setAttribute('x', (note.rect.x + note.rect.width * x) * image.width - width / 2);
      handle.setAttribute('y', (note.rect.y + note.rect.height * y) * image.height - height / 2);
      handle.setAttribute('width', width);
      handle.setAttribute('height', height);
      handle.setAttribute('rx', Math.min(width, height) * .2);
      group.append(handle);
    }
    overlay.append(group);
  }

  // The renderer replaces the SVG after every draft change; restore only our handles.
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.hasAttribute('data-selection-handles')))) renderHandles();
  }).observe(overlay, { childList: true });
  new ResizeObserver(renderHandles).observe(overlay);

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  overlay.addEventListener('pointerdown', event => {
    if (!eligible() || event.button !== 0 || !event.isPrimary || drag) return;
    const state = getState();
    if (state.tool === 'pan') return;
    const note = noteAt(event);
    if (!note) {
      resizeId = null;
      lastTap = null;
      renderHandles();
      return;
    }
    const direction = event.target.closest('[data-resize-direction]')?.dataset.resizeDirection;
    // Selection rerenders replace the clicked SVG node, so native dblclick can be lost.
    const isDoubleTap = !direction && !note.arrow && lastTap?.id === note.id &&
      event.timeStamp - lastTap.time <= 500 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 6;
    consume(event);
    if (isDoubleTap) resizeId = note.id;
    else if (resizeId !== note.id) resizeId = null;
    selectNote(note.id);
    // Revealing the editor can resize the canvas before the drag begins.
    const start = point(event);
    viewport.focus({ preventScroll: true });
    drag = { note, project: state.project, image: state.project.images[state.source], start, pointerId: event.pointerId, direction, isDoubleTap, next: null };
    overlay.setPointerCapture(event.pointerId);
    renderHandles();
  }, true);

  function updateDrag(event, preview) {
    const state = getState();
    if (!eligible() || state.project !== drag.project || state.project.images[state.source] !== drag.image || state.selectedId !== drag.note.id) {
      cancelDrag();
      return;
    }
    const position = point(event);
    const bounds = overlay.getBoundingClientRect();
    if (!drag.next && Math.hypot((position.x - drag.start.x) * bounds.width, (position.y - drag.start.y) * bounds.height) < 3) return;
    drag.next = drag.direction
      ? { ...drag.note, rect: resizedRect(drag.note.rect, drag.direction, drag.start, position, drag.image) }
      : movedNote(drag.note, drag.start, position);
    overlay.classList.add('is-adjusting-selection');
    if (preview && draftFrame === null) draftFrame = win.requestAnimationFrame(() => {
      draftFrame = null;
      if (drag?.next) showDraft(drag.next);
    });
  }

  overlay.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    consume(event);
    updateDrag(event, true);
  }, true);

  overlay.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    consume(event);
    updateDrag(event, false);
    if (!drag) return;
    const completed = drag;
    const state = getState();
    cancelDrag();
    lastTap = !completed.next && !completed.direction && !completed.isDoubleTap
      ? { id: completed.note.id, time: event.timeStamp, x: event.clientX, y: event.clientY } : null;
    if (completed.next && eligible() && state.project.images[state.source] === completed.image && state.project.annotations.some(note => note.id === completed.note.id)) commitNote(completed.next);
    renderHandles();
  }, true);
  overlay.addEventListener('pointercancel', event => {
    if (drag?.pointerId === event.pointerId) { consume(event); cancelDrag(); renderHandles(); }
  }, true);
  overlay.addEventListener('lostpointercapture', event => {
    if (drag?.pointerId === event.pointerId) { cancelDrag(); renderHandles(); }
  });
  overlay.addEventListener('canvas-gesture-cancel', () => { cancelDrag(); lastTap = null; });
  win.addEventListener('blur', () => { cancelDrag(); lastTap = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelDrag(); lastTap = null; } });

  overlay.addEventListener('dblclick', event => {
    if (!eligible()) return;
    const note = noteAt(event);
    if (!note || note.arrow) return;
    consume(event);
    cancelDrag();
    resizeId = note.id;
    selectNote(note.id);
    viewport.focus({ preventScroll: true });
    renderHandles();
  }, true);

  viewport.addEventListener('contextmenu', event => {
    if (!eligible() || !overlay.contains(event.target)) return;
    const note = noteAt(event);
    if (!note) return;
    consume(event);
    cancelDrag();
    resizeId = null;
    lastTap = null;
    deleteNote(note.id);
    viewport.focus({ preventScroll: true });
    renderHandles();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || (!drag && !resizeId)) return;
    if (event.isComposing || event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open], [popover]:popover-open')) return;
    consume(event);
    cancelDrag();
    resizeId = null;
    lastTap = null;
    renderHandles();
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-tool], [data-mode], [data-source], #new-project, #open-project, #toggle-image, .project-tabs')) {
      cancelDrag();
      resizeId = null;
      lastTap = null;
      renderHandles();
    }
  });
}
