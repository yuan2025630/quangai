function fitComparison(container, images, zoom) {
  const viewport = container.parentElement;
  const padding = getComputedStyle(viewport);
  // Leave room for fractional CSS pixels at Windows display scaling.
  const width = viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 2;
  const height = viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - 2;
  const side = container.querySelector('.side-comparison');
  const stacked = side && getComputedStyle(side).gridTemplateColumns.split(' ').length === 1;
  const gap = side ? 16 : 0;
  const columns = side && !stacked ? 2 : 1;
  const rows = stacked ? 2 : 1;
  const labels = [...container.querySelectorAll('.comparison-label')];
  const labelHeight = Math.max(0, ...labels.map(label => label.getBoundingClientRect().height + 10));
  const fit = Math.max(0.0001, Math.min(...images.map(image => Math.min(
    ((width - gap) / columns - 2) / image.width,
    ((height - (rows - 1) * gap) / rows - labelHeight - 2) / image.height,
    1,
  ))));
  const scale = zoom ?? fit;
  const imageWidths = images.map(image => image.width * scale + 2);
  container.style.width = `${Math.max(width, side && !stacked ? imageWidths.reduce((sum, value) => sum + value, gap) : Math.max(...imageWidths))}px`;
  container.querySelectorAll('.comparison-image').forEach((element, index) => {
    element.style.width = `${imageWidths[index]}px`;
    element.style.height = `${images[index].height * scale + 2}px`;
    element.style.marginInline = 'auto';
  });
  if (zoom === null) viewport.scrollLeft = viewport.scrollTop = 0;
  return scale;
}

function bindSwipe(container, position, onChange) {
  const image = container.querySelector('.swipe-comparison');
  const divider = container.querySelector('.swipe-divider');
  const original = container.querySelector('.swipe-original');
  let pointerId = null;
  const update = value => {
    position = Math.min(100, Math.max(0, value));
    divider.style.left = `${position}%`;
    divider.setAttribute('aria-valuenow', String(Math.round(position)));
    divider.setAttribute('aria-valuetext', `原图 ${Math.round(position)}%，修改稿 ${Math.round(100 - position)}%`);
    original.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    onChange(position);
  };
  const move = event => {
    const bounds = image.getBoundingClientRect();
    update((event.clientX - bounds.left - image.clientLeft) / image.clientWidth * 100);
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointerId !== null) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    pointerId = event.pointerId;
    divider.setPointerCapture(pointerId);
    divider.classList.add('dragging');
    move(event);
  });
  divider.addEventListener('pointermove', event => {
    if (event.pointerId === pointerId) move(event);
  });
  const release = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    divider.classList.remove('dragging');
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => divider.addEventListener(type, release));
  divider.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    const values = { ArrowLeft: position - step, ArrowRight: position + step, Home: 0, End: 100 };
    if (!(event.key in values)) return;
    event.preventDefault();
    event.stopPropagation();
    update(values[event.key]);
  });
  update(position);
}

function bindPress(container) {
  const image = container.querySelector('.press-comparison');
  let pointerId = null;
  const update = pressed => {
    image.classList.toggle('is-pressed', pressed);
    image.setAttribute('aria-pressed', String(pressed));
  };
  const release = () => {
    update(false);
    const previousPointer = pointerId;
    pointerId = null;
    if (previousPointer !== null && image.hasPointerCapture(previousPointer)) image.releasePointerCapture(previousPointer);
  };
  image.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointerId !== null) return;
    event.preventDefault();
    image.focus({ preventScroll: true });
    pointerId = event.pointerId;
    image.setPointerCapture(pointerId);
    update(true);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach(type => image.addEventListener(type, release));
  image.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    update(true);
  });
  image.addEventListener('keyup', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    release();
  });
}

export function renderComparison({ container, project, selectedId, comparisonMode, swipePosition = 50,
  onSwipePositionChange, zoom = null, difference, renderAnnotations, icon }) {
  const { original, revised } = project.images;
  if (!original) { container.replaceChildren(); return 1; }
  const selected = project.annotations.filter(note => note.source === 'original' && note.id === selectedId);
  const overlay = renderAnnotations(original, selected);
  if (!revised) {
    container.innerHTML = `<div class="comparison-image"><img src="${original.src}" alt="原图">${overlay}</div>`;
    return fitComparison(container, [original], zoom);
  }
  const sameSize = original.width === revised.width && original.height === revised.height;
  if (comparisonMode === 'side' || !sameSize) {
    container.innerHTML = `<div class="side-comparison">${['original', 'revised'].map(version => {
      const image = project.images[version];
      const label = version === 'original' ? '修改前 · 原图' : '修改后 · 修改稿';
      return `<div class="comparison-pane"><div class="comparison-image"><img src="${image.src}" alt="${label}" draggable="false">${renderAnnotations(image, selected)}</div></div>`;
    }).join('')}</div>`;
    return fitComparison(container, [original, revised], zoom);
  }
  if (comparisonMode === 'difference') {
    const description = difference ? difference.percent === 0 ? '未检测到像素变化' : '红色为变化像素 · 淡灰色为原图' : '正在分析像素变化…';
    container.innerHTML = `<span class="comparison-label difference-label" role="status"><strong>差异高亮</strong><span>${description}${difference?.isSampled ? '（缩小采样）' : ''}</span></span><div class="difference-comparison comparison-image"><img class="difference-base" src="${original.src}" alt="淡化的原图" draggable="false">${difference ? `<img class="difference-mask" src="${difference.src}" alt="红色像素差异" draggable="false">` : ''}${overlay}</div>`;
    return fitComparison(container, [original], zoom);
  }
  if (comparisonMode === 'swipe') {
    container.innerHTML = `<span class="comparison-label">拖动分界线，查看同一位置的修改前后</span><div class="swipe-comparison comparison-image"><img src="${revised.src}" alt="修改稿" draggable="false"><img class="swipe-original" src="${original.src}" alt="原图" draggable="false">${overlay}<div class="swipe-divider" role="slider" tabindex="0" aria-label="原图和修改稿对照分界线" aria-valuemin="0" aria-valuemax="100" aria-orientation="horizontal"><span class="swipe-grip">${icon('swipe', 22)}</span></div></div>`;
    const scale = fitComparison(container, [original], zoom);
    bindSwipe(container, swipePosition, onSwipePositionChange);
    return scale;
  }
  container.innerHTML = `<span class="comparison-label">按住图片查看修改后，松开恢复原图 · 空格 / Enter 也可对照</span><div class="press-comparison comparison-image" role="button" tabindex="0" aria-label="按住查看修改稿，松开查看原图" aria-pressed="false"><img src="${original.src}" alt="原图" draggable="false"><img class="press-revised" src="${revised.src}" alt="修改稿" draggable="false">${overlay}</div>`;
  const scale = fitComparison(container, [original], zoom);
  bindPress(container);
  return scale;
}
