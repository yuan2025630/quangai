import { syncPresentationProject } from '../../documents/presentation-project.js?version=20261013-projects';

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  );
}

export function projectContents(project) {
  let presentation = null;
  if (project.presentation) {
    const normalized = syncPresentationProject(project);
    const deck = normalized.presentation;
    presentation = { fileName: deck.fileName, assetId: deck.assetId, sha256: deck.sha256, revisedAssetId: deck.revisedAssetId ?? null,
      pages: deck.pages.map(({ number, slideId, title, images, annotations, agentSessionId }) => ({ number, slideId, title, images,
        annotations: annotations.map(note => ordered({ ...note, shape: note.shape ?? 'rectangle' })), agentSessionId })) };
    project = { ...project, images: deck.pages[0].images, annotations: deck.pages[0].annotations, agentSessionId: null };
  }
  return {
    presentation,
    title: project.title,
    generalNote: project.generalNote,
    agentSessionId: project.agentSessionId ?? null,
    images: Object.fromEntries(
      ["original", "reference", "revised"].map((role) => [
        role,
        project.images[role]
          ? {
              name: project.images[role].name,
              src: project.images[role].src,
              width: project.images[role].width,
              height: project.images[role].height,
            }
          : null,
      ]),
    ),
    annotations: project.annotations.map((note) =>
      ordered({ ...note, shape: note.shape ?? "rectangle" }),
    ),
  };
}

function equalImages(left, right) {
  return ["original", "reference", "revised"].every(role => {
    const a = left[role], b = right[role];
    return a === b || Boolean(a && b && a.name === b.name && a.src === b.src && a.width === b.width && a.height === b.height);
  });
}

function equalPresentation(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return ["fileName", "assetId", "sha256", "revisedAssetId"].every(key => left[key] === right[key]) &&
    left.pages.length === right.pages.length && left.pages.every((page, index) => {
      const other = right.pages[index];
      return ["number", "slideId", "title", "agentSessionId"].every(key => page[key] === other[key]) &&
        equalImages(page.images, other.images) && JSON.stringify(page.annotations) === JSON.stringify(other.annotations);
    });
}

function equal(left, right) {
  return (
    left.title === right.title &&
    left.generalNote === right.generalNote &&
    left.agentSessionId === right.agentSessionId &&
    equalImages(left.images, right.images) &&
    JSON.stringify(left.annotations) === JSON.stringify(right.annotations) &&
    equalPresentation(left.presentation, right.presentation)
  );
}

export function createProjectSaveState(emptyProject) {
  const empty = projectContents(emptyProject());
  let saved = null;
  return {
    snapshot() {
      return saved;
    },
    restore(snapshot) {
      saved = snapshot;
    },
    reset() {
      saved = null;
    },
    markSaved(project) {
      saved = projectContents(project);
    },
    hasUnsavedChanges(project) {
      const current = projectContents(project);
      return !equal(current, empty) && (!saved || !equal(current, saved));
    },
  };
}
