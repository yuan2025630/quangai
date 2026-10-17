import { installSelectionFrameEditing } from './selection-frame-editing.js?version=20261014-gestures-final';

const shapes = [
  ['rectangle', '矩形', '<rect x="4" y="5" width="16" height="14" rx="1"/>'],
  ['ellipse', '椭圆', '<ellipse cx="12" cy="12" rx="9" ry="8"/>'],
  ['freehand', '自由画', '<path d="M3 16c8-20 8-9 6-4s3 6 6 1 6-3 6 5"/>'],
];

export function shapeFields(note) {
  const shape = note.shape ?? 'rectangle';
  if (shape !== 'polygon' && !shapes.some(([value]) => value === shape)) throw Error('圈选方式无效。');
  if (shape === 'polygon' || shape === 'freehand') {
    if (!Array.isArray(note.points) || note.points.length < 3 || note.points.length > 2048 ||
        !note.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) {
      throw Error('圈选轮廓无效。');
    }
    return { shape, points: note.points.map(p => ({ x: p.x, y: p.y })) };
  }
  return { shape };
}

export function shapeMarkup(note, rect, color, scale, dash) {
  const attrs = `fill="${color}" fill-opacity=".07" stroke="${color}" stroke-width="${2.5 * scale}" ${dash}`;
  if (note.shape === 'ellipse') return `<ellipse cx="${rect.x + rect.width / 2}" cy="${rect.y + rect.height / 2}" rx="${rect.width / 2}" ry="${rect.height / 2}" ${attrs}/>`;
  if (note.points?.length) {
    const points = note.points.map(p => `${rect.x + p.x * rect.width},${rect.y + p.y * rect.height}`).join(' ');
    return `<polygon points="${points}" ${attrs}/>`;
  }
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${5 * scale}" ${attrs}/>`;
}

function geometry(points, shape) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const start = { x: Math.min(...xs), y: Math.min(...ys) };
  const end = { x: Math.max(...xs), y: Math.max(...ys) };
  if (end.x - start.x < .00001 || end.y - start.y < .00001) return null;
  return { start, end, shape, points: points.map(p => ({ x: (p.x - start.x) / (end.x - start.x), y: (p.y - start.y) / (end.y - start.y) })) };
}

export function installSelectionShapes({ getState, addNote, showDraft, clearDraft, selectNote, commitNote, deleteNote, readPreferences, savePreferences, showError }) {
  const rememberedShapes = { change: 'rectangle', preserve: 'rectangle' };
  let persistence = Promise.resolve();
  const menu = document.createElement('div');
  menu.id = 'selection-shape-menu';
  menu.className = 'selection-shape-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '圈选方式');
  menu.innerHTML = shapes.map(([value, label, path]) => `<button type="button" role="menuitemradio" data-shape="${value}" aria-checked="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${path}</svg><span>${label}</span><span class="shape-check" aria-hidden="true">✓</span></button>`).join('');
  document.body.append(menu);
  let anchor = null, points = [], pointer = null, drawingTool = null;
  let drawingProject = null, drawingImage = null, draftFrame = null;
  const overlay = document.getElementById('annotation-overlay');
  const viewport = document.getElementById('canvas-viewport');
  installSelectionFrameEditing({ overlay, viewport, getState, selectNote, commitNote, deleteNote, showDraft, clearDraft });
  const closeMenu = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  function cancelDrawing() {
    const pointerId = pointer, hadDrawing = pointer !== null || points.length > 0;
    points = []; pointer = null; drawingTool = null; drawingProject = null; drawingImage = null;
    if (draftFrame !== null) document.defaultView.cancelAnimationFrame(draftFrame);
    draftFrame = null;
    if (pointerId !== null && overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
    if (hadDrawing) clearDraft();
  }
  function positionMenu() {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right + 10, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - menu.offsetHeight - 8))}px`;
  }
  function refreshMenu() {
    const state = getState();
    if (state.selectionShape === 'polygon') state.selectionShape = 'rectangle';
    menu.querySelectorAll('[data-shape]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.shape === state.selectionShape)));
  }
  function activateTool(tool) {
    if (Object.hasOwn(rememberedShapes, tool)) getState().selectionShape = rememberedShapes[tool];
  }
  function refreshHints() {
    for (const [tool, label, shortcut] of [['change', '修改', 'B'], ['preserve', '保留', 'P']]) {
      const button = document.querySelector(`button[data-tool="${tool}"]`);
      const shapeLabel = shapes.find(([value]) => value === rememberedShapes[tool])[1];
      button.title = `${label} (${shortcut}) · ${shapeLabel}；单击沿用，双击选择圈选方式；Alt+↓ 打开菜单`;
      button.setAttribute('aria-label', `${label}，圈选方式：${shapeLabel}`);
    }
  }
  function openMenu(button) {
    const state = getState();
    if (state.busy || state.imageHidden || state.mode !== 'edit') return;
    closeMenu(); anchor = button;
    refreshMenu(); menu.showPopover(); positionMenu(); menu.querySelector('[aria-checked="true"]').focus();
  }
  document.querySelectorAll('button[data-tool]').forEach(button => {
    if (Object.hasOwn(rememberedShapes, button.dataset.tool)) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', menu.id);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-keyshortcuts', 'Alt+ArrowDown');
      button.addEventListener('dblclick', () => openMenu(button));
      button.addEventListener('keydown', event => {
        if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault(); event.stopPropagation();
          button.click(); openMenu(button);
        }
      });
    }
    button.addEventListener('click', () => { cancelDrawing(); closeMenu(); });
  });
  menu.addEventListener('toggle', () => document.querySelectorAll('[aria-controls="selection-shape-menu"]').forEach(button => button.setAttribute('aria-expanded', String(button === anchor && menu.matches(':popover-open')))));
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-shape]');
    if (!button || !anchor) return;
    getState().selectionShape = button.dataset.shape;
    rememberedShapes[anchor.dataset.tool] = button.dataset.shape;
    const snapshot = { ...rememberedShapes };
    persistence = persistence.then(() => savePreferences(snapshot)).catch(error => showError(Error('圈选方式未能保存，重启后可能无法恢复。', { cause: error })));
    refreshHints();
    refreshMenu(); closeMenu(); anchor?.focus();
  });
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); anchor?.focus(); }
  });
  addEventListener('resize', positionMenu);
  document.querySelector('.tool-rail').addEventListener('scroll', positionMenu);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-mode], [data-source], #new-project, #open-project, #toggle-image, .project-tabs, [data-presentation-page], #presentation-previous, #presentation-next')) { closeMenu(); cancelDrawing(); }
  });
  function eligible() {
    const state = getState();
    return !state.busy && !state.imageHidden && state.mode === 'edit' && state.source === 'original' && state.project.images.original && ['change', 'preserve'].includes(state.tool) && state.selectionShape === 'freehand';
  }
  function point(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function drawingEligible() {
    const state = getState();
    return eligible() && state.project === drawingProject && state.project.images.original === drawingImage && state.tool === drawingTool;
  }
  function preview() {
    const state = getState(), draft = geometry(points, state.selectionShape);
    if (draft) showDraft({ kind: drawingTool, ...draft });
  }
  function finish() {
    const state = getState(), draft = geometry(points, state.selectionShape), tool = drawingTool;
    const canCommit = drawingEligible(), image = drawingImage;
    cancelDrawing();
    if (draft && draft.points.length >= 3 && canCommit && (draft.end.x - draft.start.x) * image.width >= 5 && (draft.end.y - draft.start.y) * image.height >= 5) {
      addNote(tool, draft.start, draft.end, { shape: draft.shape, points: draft.points });
    }
  }
  overlay.addEventListener('pointerdown', event => {
    if (!eligible() || event.button !== 0 || !event.isPrimary || pointer !== null) return;
    event.preventDefault(); event.stopImmediatePropagation(); closeMenu();
    viewport.focus({ preventScroll: true });
    const state = getState();
    drawingTool = state.tool; drawingProject = state.project; drawingImage = state.project.images.original;
    points = [point(event)]; pointer = event.pointerId; overlay.setPointerCapture(pointer);
  }, true);
  overlay.addEventListener('pointermove', event => {
    if (!points.length || pointer !== event.pointerId) return;
    if (!drawingEligible()) { cancelDrawing(); return; }
    event.stopImmediatePropagation();
    if (points.length < 2048) points.push(point(event));
    if (draftFrame === null) draftFrame = document.defaultView.requestAnimationFrame(() => {
      draftFrame = null;
      if (drawingEligible()) preview();
      else cancelDrawing();
    });
  }, true);
  overlay.addEventListener('pointerup', event => {
    if (pointer !== event.pointerId) return;
    event.stopImmediatePropagation();
    if (!drawingEligible()) { cancelDrawing(); return; }
    if (points.length < 2048) points.push(point(event));
    finish();
  }, true);
  overlay.addEventListener('pointercancel', event => { if (pointer === event.pointerId) cancelDrawing(); }, true);
  overlay.addEventListener('lostpointercapture', event => { if (pointer === event.pointerId) cancelDrawing(); });
  overlay.addEventListener('canvas-gesture-cancel', cancelDrawing);
  document.defaultView?.addEventListener('blur', cancelDrawing);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrawing(); });
  document.addEventListener('keydown', event => {
    if (!points.length) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancelDrawing(); }
  }, true);
  refreshHints();
  const ready = readPreferences().then(saved => {
    for (const tool of Object.keys(rememberedShapes)) {
      if (shapes.some(([value]) => value === saved?.[tool])) rememberedShapes[tool] = saved[tool];
    }
    activateTool(getState().tool); refreshHints();
  }).catch(error => showError(Error('圈选方式记忆未能恢复，暂用矩形。', { cause: error })));
  return { activateTool, ready };
}
