import assert from 'node:assert/strict';
import { createProjectSaveState } from '../../发布/圈改/web/assets/completion/review/project-save-state.js';
import { importPresentation, selectPresentationPage } from '../../发布/圈改/web/assets/documents/presentation-project.js';

const empty = () => ({ title: '', generalNote: '', images: { original: null, reference: null, revised: null }, annotations: [] });
const image = { name: 'page.png', src: 'data:image/png;base64,AA==', width: 1600, height: 900 };
const original = importPresentation(empty(), { fileName: 'deck.pptx', assetId: 'a'.repeat(32), sha256: 'b'.repeat(64),
  pages: [1,2,3].map(number => ({ number, slideId: 255 + number, title: `Slide ${number}`, image })) });
const state = createProjectSaveState(empty);
state.markSaved(original);
assert.equal(state.hasUnsavedChanges(original), false);
assert.equal(state.hasUnsavedChanges(selectPresentationPage(original, 3)), false);
assert.equal(state.hasUnsavedChanges({ ...original, presentation: { ...original.presentation, exportFolder: 'new export' } }), false);
console.log('PASS page navigation and export paths do not mark unchanged content dirty');

for (const [field, value] of [['fileName', 'changed.pptx'], ['assetId', 'c'.repeat(32)], ['sha256', 'd'.repeat(64)], ['revisedAssetId', 'e'.repeat(32)]]) {
  assert.equal(state.hasUnsavedChanges({ ...original, presentation: { ...original.presentation, [field]: value } }), true, field);
}
for (const [field, value] of [['name', 'changed.png'], ['src', 'data:image/png;base64,AQ=='], ['width', 800], ['height', 600]]) {
  const pages = original.presentation.pages.map(page => page.number === 2 ? { ...page, images: { ...page.images, original: { ...image, [field]: value } } } : page);
  assert.equal(state.hasUnsavedChanges({ ...original, presentation: { ...original.presentation, pages } }), true, field);
}
for (const [field, value] of [['number', 4], ['slideId', 1000], ['title', 'changed'], ['agentSessionId', 'session']]) {
  const pages = original.presentation.pages.map(page => page.number === 2 ? { ...page, [field]: value } : page);
  assert.equal(state.hasUnsavedChanges({ ...original, presentation: { ...original.presentation, pages } }), true, field);
}
const edited = selectPresentationPage(original, 2);
edited.annotations = [{ id: 'note', number: 1, kind: 'change', source: 'original', status: 'pending', comment: 'change title' }];
assert.equal(state.hasUnsavedChanges(edited), true);
state.markSaved(edited);
assert.equal(state.hasUnsavedChanges(selectPresentationPage(edited, 3)), false);
assert.equal(state.hasUnsavedChanges({ ...edited, title: 'changed' }), true);
console.log('PASS deck identities, page identities, all image fields and inactive-page annotations are tracked');
