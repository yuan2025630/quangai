import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installPresentationExport } from '../../发布/圈改/web/assets/documents/presentation-export.js';
import { importPresentation, selectPresentationPage } from '../../发布/圈改/web/assets/documents/presentation-project.js';

async function checkDelayedImageBinding() {
  const source = await readFile(new URL('../../发布/圈改/web/assets/index-C4zKZ-Vc.js', import.meta.url), 'utf8');
  const start = source.indexOf('function Gt('), end = source.indexOf('async function Yt(', start);
  assert.ok(start >= 0 && end > start, 'The production image collaboration controller must be located.');
  const elements = Object.fromEntries([
    'agent-live', 'agent-live-state', 'agent-export-status', 'agent-folder', 'agent-prompt',
    'agent-details', 'copy-agent-prompt', 'open-agent-folder', 'export-agent',
  ].map(id => [id, { value: '', hidden: false, disabled: false, textContent: '' }]));
  let responseListener, request;
  const bridge = {
    postMessage(message) { request = message; },
    addEventListener(name, listener) { assert.equal(name, 'message'); responseListener = listener; },
  };
  const context = vm.createContext({
    window: { chrome: { webview: bridge } }, document: { getElementById: id => elements[id] },
    crypto: { randomUUID: () => 'delayed-binding' },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.createAgent = Gt;`, context);
  const project = { agentSessionId: null, presentation: { exportFolder: 'D:\\PPT A\\导出\\本轮' }, images: { original: {} } };
  const errors = [];
  const agent = context.createAgent({ getProject: () => project, isBusy: () => false, onResult() {}, onError: error => errors.push(error) });
  const pendingBinding = agent.sync();
  assert.equal(request.command, 'agent-bind');
  assert.equal(request.sessionId, null);

  Object.assign(elements['agent-folder'], { value: project.presentation.exportFolder });
  Object.assign(elements['agent-prompt'], { value: 'PPT A 本轮提示词' });
  Object.assign(elements['agent-details'], { hidden: false });
  Object.assign(elements['copy-agent-prompt'], { disabled: false });
  Object.assign(elements['open-agent-folder'], { disabled: false });
  Object.assign(elements['export-agent'], { disabled: false });
  Object.assign(elements['agent-export-status'], { textContent: 'PPT 导出已就绪' });
  const expected = JSON.stringify(elements);

  responseListener({ data: { type: 'agent-response', requestId: request.requestId, ok: true, result: null } });
  await pendingBinding;
  assert.equal(JSON.stringify(elements), expected, 'A delayed image binding response must preserve PPT export controls.');
  assert.equal(elements['agent-live'].hidden, true, 'PPT must hide the previous image return banner.');
  await agent.sync();
  assert.equal(JSON.stringify(elements), expected, 'Repeated renders must preserve PPT export details.');
  assert.equal(errors.length, 0);

  project.presentation = null;
  await agent.sync();
  assert.equal(elements['agent-folder'].value, '');
  assert.equal(elements['agent-prompt'].value, '');
  assert.equal(elements['agent-details'].hidden, true);
  assert.equal(elements['copy-agent-prompt'].disabled, true, 'Unconnected image projects must retain their normal disabled controls.');
}

function presentationFixture(id, targetPage, folder = null) {
  const image = { name: 'page.png', src: 'data:image/png;base64,AA==', width: 640, height: 360 };
  const empty = { schemaVersion: 1, title: '', generalNote: '', images: { original: null, reference: null, revised: null }, annotations: [], storageId: id };
  let project = importPresentation(empty, {
    fileName: `${id}.pptx`, assetId: 'a'.repeat(32), sha256: 'b'.repeat(64),
    pages: [1, 2, 3, 4].map(number => ({ number, slideId: 255 + number, title: `第 ${number} 页`, image })),
  });
  project = selectPresentationPage(project, targetPage);
  project.annotations = [{ id: `${id}-note`, number: 1, source: 'original', kind: 'change', status: 'pending', comment: `${id} 修改标题`, rect: { x: .1, y: .1, width: .3, height: .2 }, shape: 'rectangle', targetId: null }];
  project.presentation.exportFolder = folder;
  return project;
}

async function checkProjectSpecificCopy() {
  const previousGlobals = Object.fromEntries(['document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const elements = { 'agent-prompt': { value: '' }, 'agent-folder': { value: '' }, 'agent-details': { open: false } };
  let promptFocusCount = 0, promptSelectionCount = 0;
  elements['agent-prompt'].focus = () => { promptFocusCount++; };
  elements['agent-prompt'].select = () => { promptSelectionCount++; };
  const copied = [], requests = [], messages = [], errors = [];
  let listener, current = presentationFixture('PPT A', 2);
  const folders = { 'PPT A': 'D:\\项目库\\PPT A\\导出\\本轮', 'PPT B': 'D:\\项目库\\PPT B\\导出\\本轮' };
  const resolvedFolders = { ...folders };
  let delayedResolution = false, finishResolution;
  let delayedClipboard = false, rejectClipboard;
  const select = project => { current = project; };
  const click = id => listener({ target: { closest: () => ({ id, disabled: false }) }, preventDefault() {}, stopImmediatePropagation() {} });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      addEventListener(name, callback) { assert.equal(name, 'click'); listener = callback; },
      getElementById: id => elements[id],
    } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(text) {
      if (delayedClipboard) return new Promise((resolve, reject) => { rejectClipboard = reject; });
      copied.push(text);
    } } } });
    const controls = installPresentationExport({
      async request(command, payload) {
        requests.push({ command, payload });
        if (command === 'presentation-export') {
          const project = JSON.parse(payload.projectJson);
          return { folder: folders[project.storageId] };
        }
        assert.ok(Object.hasOwn(folders, payload.id), 'Copy/open before export must never request the library root.');
        if (command === 'resolve-export') {
          assert.equal(payload.folder, folders[payload.id], 'The resolver must receive the current project export record.');
          if (delayedResolution) return new Promise(resolve => { finishResolution = () => resolve({ folder: resolvedFolders[payload.id] }); });
          return { folder: resolvedFolders[payload.id] };
        }
        assert.equal(command, 'open-export');
        assert.equal(payload.folder, resolvedFolders[payload.id], 'Open must use the resolved current path.');
        return { opened: true };
      },
      library: { root: 'D:\\项目库', async flush() {} }, getProject: () => current,
      isBusy: () => false, runBusy: operation => operation(), scope: () => 'pending',
      buildInstructions: () => 'Fixture instructions',
      annotateImage: async image => image.src, cropImage: async image => image.src,
      commitProject: select, notify: message => messages.push(message), showError: error => errors.push(error),
    });
    await controls.exportPresentation(false);
    const projectA = current;
    select(presentationFixture('PPT B', 4));
    await controls.exportPresentation(false);
    const projectB = current;

    resolvedFolders['PPT A'] = 'D:\\迁移后的项目库\\已改名 PPT A\\导出\\本轮';
    select(projectA); click('copy-agent-prompt'); await settle();
    assert.ok(copied.at(-1).includes(resolvedFolders['PPT A']), 'Copied instructions must use the resolved migrated path.');
    assert.ok(!copied.at(-1).includes(folders['PPT A']));
    assert.ok(!copied.at(-1).includes(folders['PPT B']));
    assert.match(copied.at(-1), /第 2 页（页面 ID 257）/);
    assert.doesNotMatch(copied.at(-1), /第 4 页（页面 ID 259）/);

    select(projectB); click('copy-agent-prompt'); await settle();
    assert.ok(copied.at(-1).includes(folders['PPT B']));
    assert.ok(!copied.at(-1).includes(folders['PPT A']));
    assert.match(copied.at(-1), /第 4 页（页面 ID 259）/);
    assert.doesNotMatch(copied.at(-1), /第 2 页（页面 ID 257）/);
    click('open-agent-folder'); await settle();
    assert.equal(requests.at(-1).command, 'open-export');
    assert.equal(requests.at(-1).payload.id, 'PPT B');
    assert.equal(requests.at(-1).payload.folder, folders['PPT B']);
    assert.equal(errors.length, 0);

    select(projectA); delayedResolution = true;
    const beforeSwitchCopies = copied.length;
    click('copy-agent-prompt'); await settle();
    assert.equal(typeof finishResolution, 'function');
    select(projectB); finishResolution(); await settle();
    assert.equal(copied.length, beforeSwitchCopies, 'Switching projects during resolution must cancel the copy.');
    assert.match(errors.at(-1).message, /切换/);
    delayedResolution = false;

    select(projectA); delayedClipboard = true;
    click('copy-agent-prompt'); await settle();
    assert.equal(typeof rejectClipboard, 'function', 'The clipboard operation must be pending before switching projects.');
    select(projectB);
    elements['agent-prompt'].value = 'PPT B 当前提示词';
    elements['agent-folder'].value = folders['PPT B'];
    elements['agent-details'].open = false;
    const focusCount = promptFocusCount, selectionCount = promptSelectionCount;
    rejectClipboard(new Error('Clipboard permission rejected after project switch')); await settle();
    assert.equal(elements['agent-details'].open, false, 'A stale clipboard failure must not expand the new project details.');
    assert.equal(promptFocusCount, focusCount, 'A stale clipboard failure must not focus the new project prompt.');
    assert.equal(promptSelectionCount, selectionCount, 'A stale clipboard failure must not select the new project prompt.');
    assert.equal(elements['agent-prompt'].value, 'PPT B 当前提示词');
    assert.equal(elements['agent-folder'].value, folders['PPT B']);
    assert.match(messages.at(-1), /当前项目重新复制/);
    delayedClipboard = false;

    select(presentationFixture('未导出 PPT', 3));
    const copyCount = copied.length, requestCount = requests.length, messageCount = messages.length;
    click('copy-agent-prompt'); click('open-agent-folder'); await settle();
    assert.equal(copied.length, copyCount, 'A PPT without an export must not copy stale or root-folder instructions.');
    assert.equal(requests.length, requestCount, 'A PPT without an export must not open/request the library root.');
    assert.ok([...messages.slice(messageCount), ...errors.map(error => error.message)].some(message => /先.*导出/.test(message)), 'Missing export must provide an actionable instruction.');
  } finally {
    for (const [name, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

await checkDelayedImageBinding();
await checkProjectSpecificCopy();
console.log('Delayed image binding, PPT export ownership, migrated paths, project switching, stale clipboard failures and missing-export guards passed.');
