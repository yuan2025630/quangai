const GUID = /^[0-9a-f]{32}$/i;

export function syncPresentationProject(project) {
  const deck = project.presentation;
  if (!deck) return project;
  return {
    ...project,
    presentation: { ...deck, pages: deck.pages.map(page => page.number === deck.activePage
      ? { ...page, images: project.images, annotations: project.annotations, agentSessionId: project.agentSessionId ?? null }
      : page) },
  };
}

export function selectPresentationPage(project, number) {
  const current = syncPresentationProject(project);
  const page = current.presentation?.pages.find(candidate => candidate.number === number);
  if (!page) throw new Error('PPT 页码无效。');
  return { ...current, images: page.images, annotations: page.annotations, agentSessionId: page.agentSessionId ?? null,
    presentation: { ...current.presentation, activePage: number } };
}

export function importPresentation(project, rendered) {
  const pages = rendered.pages.map(page => ({ number: page.number, slideId: page.slideId, title: page.title,
    images: { original: page.image, reference: null, revised: null }, annotations: [], agentSessionId: null }));
  if (!pages.length) throw new Error('PPT 中没有可导入的页面。');
  return { ...project, title: rendered.fileName.replace(/\.[^.]+$/, ''), images: pages[0].images, annotations: [], agentSessionId: null,
    presentation: { fileName: rendered.fileName, assetId: rendered.assetId, sha256: rendered.sha256, activePage: 1, pages } };
}

export function importRevisedPresentation(project, rendered) {
  const current = syncPresentationProject(project);
  const originals = current.presentation.pages;
  const revisions = new Map(rendered.pages.map(page => [page.slideId, page]));
  if (rendered.pages.length !== originals.length || originals.some((page, index) => rendered.pages[index].slideId !== page.slideId))
    throw new Error('修改稿的页面 ID 与原 PPT 不一致，无法准确配对。请保留原有页面后再导入。');
  const pages = originals.map(page => ({ ...page, images: { ...page.images, revised: revisions.get(page.slideId).image },
    annotations: page.annotations.map(note => note.kind === 'preserve' || note.kind === 'reference' ? note : { ...note, status: 'pending' }) }));
  const active = pages.find(page => page.number === current.presentation.activePage);
  return { ...current, images: active.images, annotations: active.annotations,
    presentation: { ...current.presentation, revisedAssetId: rendered.assetId, revisedSha256: rendered.sha256, revisedFileName: rendered.fileName, pages } };
}

export function promoteRevisedPresentation(project) {
  const current = syncPresentationProject(project), deck = current.presentation;
  if (!deck?.revisedAssetId || !deck.revisedSha256 || deck.pages.some(page => !page.images.revised))
    throw new Error('请先导入完整的修改后 PPT，再将其作为新的原稿。');
  const pages = deck.pages.map(page => ({ ...page, agentSessionId: null,
    images: { ...page.images, original: page.images.revised, revised: null } }));
  const active = pages.find(page => page.number === deck.activePage);
  return { ...current, images: active.images, annotations: active.annotations, agentSessionId: null,
    presentation: { ...deck, assetId: deck.revisedAssetId, sha256: deck.revisedSha256,
      fileName: deck.revisedFileName ?? deck.fileName, revisedAssetId: null, revisedSha256: null, revisedFileName: null, exportFolder: null, pages } };
}

export function normalizePresentation(deck, validatePage) {
  if (deck == null) return null;
  if (typeof deck.fileName !== 'string' || !/\.pptx?$/i.test(deck.fileName) || !GUID.test(deck.assetId)
      || !/^[0-9a-f]{64}$/i.test(deck.sha256) || !Array.isArray(deck.pages) || !deck.pages.length || deck.pages.length > 400
      || !Number.isInteger(deck.activePage) || deck.activePage < 1 || deck.activePage > deck.pages.length
      || deck.revisedAssetId != null && (!GUID.test(deck.revisedAssetId) || !/^[0-9a-f]{64}$/i.test(deck.revisedSha256)
        || typeof deck.revisedFileName !== 'string' || !/\.pptx?$/i.test(deck.revisedFileName))) throw new Error('PPT 项目信息无效。');
  const ids = new Set();
  const pages = deck.pages.map((page, index) => {
    if (page.number !== index + 1 || !Number.isInteger(page.slideId) || page.slideId < 1 || ids.has(page.slideId) || typeof page.title !== 'string')
      throw new Error('PPT 页面标识无效。');
    ids.add(page.slideId);
    const validated = validatePage(page);
    if (!validated.images.original) throw new Error('PPT 页面预览缺失。');
    return { number: page.number, slideId: page.slideId, title: page.title.slice(0, 160), images: validated.images,
      annotations: validated.annotations, agentSessionId: validated.agentSessionId };
  });
  return { fileName: deck.fileName.slice(0, 240), assetId: deck.assetId, sha256: deck.sha256, activePage: deck.activePage,
    revisedAssetId: deck.revisedAssetId ?? null, revisedSha256: deck.revisedSha256 ?? null, revisedFileName: deck.revisedFileName ?? null, pages,
    exportFolder: typeof deck.exportFolder === 'string' ? deck.exportFolder : null };
}

export function presentationPages(project, scope, exportAnnotations) {
  if (!project.presentation) return [];
  return syncPresentationProject(project).presentation.pages.map(page => {
    const pageProject = { ...project, presentation: null, images: page.images, annotations: page.annotations, agentSessionId: null };
    return { ...page, project: pageProject, notes: exportAnnotations(pageProject, scope) };
  });
}
