const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const editable = target => target.closest('input,textarea,select,[contenteditable]');

export function installCanvasGestures({ viewport, artboard, overlay, getState, selectNote, addNote, showDraft, clearDraft, zoom, fit }) {
  const doc = viewport.ownerDocument;
  const win = doc.defaultView;
  let gesture = null, spaceHeld = false, draftFrame = null, pendingDraft = null;
  let wheelFrame = null, wheelDelta = 0, wheelPoint = null;

  function image(state) {
    return state.project.images[state.mode === 'review' ? 'original' : state.source];
  }

  function available() {
    const state = getState();
    return !state.busy && !state.imageHidden && !!image(state);
  }

  function point(event) {
    const bounds = overlay.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function discardDraft() {
    if (draftFrame !== null) win.cancelAnimationFrame(draftFrame);
    draftFrame = null;
    pendingDraft = null;
  }

  function cancel() {
    const previous = gesture;
    gesture = null;
    discardDraft();
    viewport.classList.remove('is-panning', 'is-drawing');
    if (!previous) return;
    if (previous.owner.hasPointerCapture(previous.pointerId)) previous.owner.releasePointerCapture(previous.pointerId);
    if (previous.kind === 'draw') clearDraft();
  }

  function interrupt() {
    cancel();
    overlay.dispatchEvent(new Event('canvas-gesture-cancel'));
  }

  function validDrawing() {
    const state = getState();
    return available() && state.mode === 'edit' && state.project === gesture.project &&
      state.source === gesture.source && state.tool === gesture.tool && state.selectionShape === gesture.shape;
  }

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || !available() || editable(event.target) || event.target.closest('button')) return;
    const state = getState();
    const shouldPan = event.button === 1 || (event.button === 0 && (spaceHeld || (state.mode === 'edit' && state.tool === 'pan')));
    if (!shouldPan) return;
    consume(event);
    interrupt();
    gesture = { kind: 'pan', pointerId: event.pointerId, owner: viewport, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
    viewport.focus({ preventScroll: true });
  }, true);

  overlay.addEventListener('pointerdown', event => {
    const state = getState();
    if (gesture || !available() || event.button !== 0 || !event.isPrimary || state.mode !== 'edit' || state.tool === 'pan') return;
    if (state.tool === 'select') { selectNote(null); viewport.focus({ preventScroll: true }); return; }
    // Freehand and existing-frame gestures are handled by their own modules.
    if (state.source === 'original' && ['change', 'preserve'].includes(state.tool) && state.selectionShape === 'freehand') return;
    consume(event);
    gesture = { kind: 'draw', owner: overlay, pointerId: event.pointerId, start: point(event), project: state.project, source: state.source, tool: state.tool, shape: state.selectionShape };
    overlay.setPointerCapture(event.pointerId);
    viewport.classList.add('is-drawing');
    viewport.focus({ preventScroll: true });
  });

  viewport.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    consume(event);
    if (!available()) { interrupt(); return; }
    if (gesture.kind === 'pan') {
      viewport.scrollLeft = gesture.left + gesture.x - event.clientX;
      viewport.scrollTop = gesture.top + gesture.y - event.clientY;
      return;
    }
    if (!validDrawing()) { cancel(); return; }
    pendingDraft = { kind: gesture.source === 'reference' ? 'reference' : gesture.tool, start: gesture.start, end: point(event) };
    if (draftFrame === null) draftFrame = win.requestAnimationFrame(() => {
      draftFrame = null;
      if (gesture?.kind === 'draw' && validDrawing()) showDraft(pendingDraft);
    });
  }, true);

  viewport.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    consume(event);
    if (gesture.kind === 'pan') { cancel(); return; }
    const drawing = gesture, valid = validDrawing(), end = point(event), sourceImage = image(getState());
    cancel();
    if (!valid) return;
    const width = Math.abs(end.x - drawing.start.x) * sourceImage.width;
    const height = Math.abs(end.y - drawing.start.y) * sourceImage.height;
    if (drawing.tool === 'move' ? Math.hypot(width, height) >= 8 : width >= 5 && height >= 5) {
      addNote(drawing.source === 'reference' ? 'reference' : drawing.tool, drawing.start, end,
        { shape: drawing.source === 'original' && ['change', 'preserve'].includes(drawing.tool) ? drawing.shape : 'rectangle' });
    }
  }, true);

  for (const type of ['pointercancel', 'lostpointercapture']) viewport.addEventListener(type, event => {
    if (gesture?.pointerId === event.pointerId) cancel();
  }, true);
  overlay.addEventListener('canvas-gesture-cancel', cancel);
  viewport.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  artboard.addEventListener('dragstart', event => event.preventDefault());

  function releaseSpace() {
    spaceHeld = false;
    viewport.classList.remove('is-pan-ready');
  }

  doc.addEventListener('keydown', event => {
    if (event.isComposing || editable(event.target) || doc.querySelector('dialog[open], [popover]:popover-open')) return;
    if (event.key === 'Escape' && gesture) { consume(event); interrupt(); releaseSpace(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || !viewport.contains(event.target) || !available()) return;
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      if (!spaceHeld) { interrupt(); spaceHeld = true; viewport.classList.add('is-pan-ready'); }
      return;
    }
    if (gesture || getState().draft) return;
    if (['+', '=', '-', '0', '1'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') fit();
      else if (event.key === '1') {
        const state = getState(), displayed = state.mode === 'review' ? viewport.querySelector('.comparison-image') : artboard;
        if (displayed) zoom(image(state).width / displayed.getBoundingClientRect().width);
      } else zoom(event.key === '-' ? .8 : 1.25);
    }
  }, true);
  doc.addEventListener('keyup', event => { if (event.code === 'Space' || event.key === ' ') releaseSpace(); }, true);

  viewport.addEventListener('wheel', event => {
    if ((!event.ctrlKey && !event.metaKey) || !available()) return;
    event.preventDefault();
    if (gesture || getState().draft) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    wheelDelta += clamp(event.deltaY * unit, -160, 160);
    wheelPoint = { x: event.clientX, y: event.clientY };
    if (wheelFrame === null) wheelFrame = win.requestAnimationFrame(() => {
      wheelFrame = null;
      const delta = wheelDelta, anchor = wheelPoint;
      wheelDelta = 0;
      if (available() && !gesture) zoom(Math.exp(-delta * .002), anchor);
    });
  }, { passive: false });

  function reset() {
    interrupt();
    releaseSpace();
    if (wheelFrame !== null) win.cancelAnimationFrame(wheelFrame);
    wheelFrame = null;
    wheelDelta = 0;
  }
  win.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) reset(); });
  doc.addEventListener('click', event => {
    if (event.target.closest('[data-tool], [data-mode], [data-source], [data-compare], [data-presentation-page], .project-tabs, #presentation-previous, #presentation-next, #presentation-jump, #new-project, #open-project, #toggle-image, #focus-canvas, #zoom-in, #zoom-out, #zoom-label')) reset();
  }, true);
}
