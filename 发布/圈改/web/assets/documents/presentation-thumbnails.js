export function installPresentationThumbnails(container, onError) {
  const maxWidth = 440;
  const images = new Map();
  let enabled = false;
  let loading = false;
  let minimized = false;

  function release(entry) {
    entry.visible = false;
    entry.image.removeAttribute('src');
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = null;
  }

  async function loadVisible() {
    if (loading) return;
    loading = true;
    try {
      let entry;
      while ((entry = [...images.values()].find(item => item.visible && !item.url && !item.failed))) {
        let bitmap;
        try {
          const [header, encoded] = entry.source.src.split(',');
          const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
          const width = Math.min(maxWidth, entry.source.width);
          bitmap = await createImageBitmap(new Blob([bytes], { type: header.slice(5).split(';')[0] }), {
            resizeWidth: width, resizeHeight: Math.max(1, Math.round(width * entry.source.height / entry.source.width)),
          });
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
          canvas.width = canvas.height = 0;
          if (entry.visible && images.get(entry.image) === entry) {
            entry.url = URL.createObjectURL(thumbnail);
            entry.image.src = entry.url;
          }
        } catch (error) {
          entry.failed = true;
          if (entry.visible && images.get(entry.image) === entry) onError(`PPT 缩略图读取失败：${error.message}。仍可通过页码切换。`);
        } finally { bitmap?.close(); }
      }
    } finally { loading = false; }
  }

  const observer = new IntersectionObserver(entries => {
    for (const observed of entries) {
      const entry = images.get(observed.target);
      if (!entry) continue;
      entry.visible = enabled && !document.hidden && !minimized && observed.isIntersecting;
      if (!entry.visible) release(entry);
    }
    void loadVisible();
  }, { root: container, rootMargin: '80px' });

  function sync() {
    observer.disconnect();
    for (const entry of images.values()) {
      release(entry);
      if (enabled && !document.hidden && !minimized) observer.observe(entry.image);
    }
  }

  document.addEventListener('visibilitychange', sync);
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data?.type !== 'window-state' || typeof data.isMinimized !== 'boolean' || data.isMinimized === minimized) return;
    minimized = data.isMinimized;
    sync();
  });
  window.addEventListener('pagehide', () => { enabled = false; sync(); images.clear(); });

  return {
    reset(sources = []) {
      observer.disconnect();
      for (const entry of images.values()) release(entry);
      images.clear();
      container.querySelectorAll('img').forEach((image, index) => {
        if (!sources[index]) return;
        images.set(image, { image, source: sources[index], visible: false, url: null, failed: false });
      });
      sync();
    },
    setVisible(value) {
      if (enabled === value) return;
      enabled = value;
      sync();
    },
  };
}
