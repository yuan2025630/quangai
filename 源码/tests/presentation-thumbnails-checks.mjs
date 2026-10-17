import assert from 'node:assert/strict';
import { installPresentationThumbnails } from '../../发布/圈改/web/assets/documents/presentation-thumbnails.js';

const events = new Map(), messages = [];
const urls = new Set(), bitmaps = [];
let observer, pendingDecode;
globalThis.document = { hidden: false, addEventListener: (name, listener) => events.set(name, listener) };
globalThis.window = { addEventListener: (name, listener) => events.set(name, listener), chrome: { webview: { addEventListener: (_, listener) => messages.push(listener) } } };
globalThis.IntersectionObserver = class {
  observed = new Set();
  constructor(callback) { this.callback = callback; observer = this; }
  disconnect() { this.observed.clear(); }
  observe(image) { this.observed.add(image); }
  visible(image, isIntersecting = true) { this.callback([{ target: image, isIntersecting }]); }
};
globalThis.createImageBitmap = async () => {
  if (pendingDecode) await pendingDecode;
  const bitmap = { width: 440, height: 248, closed: false, close() { this.closed = true; } };
  bitmaps.push(bitmap);
  return bitmap;
};
globalThis.OffscreenCanvas = class {
  getContext() { return { drawImage() {} }; }
  async convertToBlob() { return new Blob(['thumbnail']); }
};
URL.createObjectURL = () => { const url = `blob:${crypto.randomUUID()}`; urls.add(url); return url; };
URL.revokeObjectURL = url => { assert.ok(urls.delete(url), 'each URL must be released exactly once'); };
const image = () => ({ src: null, removeAttribute() { this.src = null; } });
let elements = [image(), image()];
const container = { querySelectorAll() { return elements; } };
const errors = [];
const thumbnails = installPresentationThumbnails(container, message => errors.push(message));
const source = { src: 'data:image/png;base64,AA==', width: 1600, height: 900 };
const idle = () => new Promise(resolve => setImmediate(resolve));

thumbnails.reset([source, source]);
assert.equal(observer.observed.size, 0);
thumbnails.setVisible(true);
assert.equal(observer.observed.size, 2);
observer.visible(elements[0]); await idle();
assert.ok(elements[0].src?.startsWith('blob:'));
assert.equal(elements[1].src, null);
assert.equal(urls.size, 1);
assert.ok(bitmaps.every(bitmap => bitmap.closed));
observer.visible(elements[0], false);
assert.equal(urls.size, 0);
assert.equal(elements[0].src, null);
console.log('PASS only visible previews are loaded; scrolling releases URLs and decoded bitmaps');

let finish;
pendingDecode = new Promise(resolve => { finish = resolve; });
observer.visible(elements[0]);
thumbnails.setVisible(false);
finish(); await idle(); pendingDecode = null;
assert.equal(elements[0].src, null);
assert.equal(urls.size, 0);
assert.equal(observer.observed.size, 0);
assert.ok(bitmaps.every(bitmap => bitmap.closed));
console.log('PASS collapsing during image decode never resurrects a hidden thumbnail');

thumbnails.setVisible(true);
pendingDecode = new Promise(resolve => { finish = resolve; });
const old = elements[0];
observer.visible(old);
elements = [image()];
thumbnails.reset([source]);
observer.visible(elements[0]);
finish(); await idle(); pendingDecode = null;
assert.equal(old.src, null);
assert.ok(elements[0].src?.startsWith('blob:'));
assert.equal(urls.size, 1);
console.log('PASS switching projects discards old decodes and loads the current preview');

messages[0]({ data: { type: 'window-state', isMinimized: true } });
assert.equal(urls.size, 0);
assert.equal(observer.observed.size, 0);
messages[0]({ data: { type: 'window-state', isMinimized: false } });
assert.equal(observer.observed.size, 1);
observer.visible(elements[0]); await idle();
assert.equal(urls.size, 1);
document.hidden = true; events.get('visibilitychange')();
assert.equal(urls.size, 0);
document.hidden = false; events.get('visibilitychange')();
assert.equal(observer.observed.size, 1);
console.log('PASS minimizing and hiding release previews; restoring resumes observation');

events.get('pagehide')();
assert.equal(observer.observed.size, 0);
assert.equal(urls.size, 0);
assert.ok(bitmaps.every(bitmap => bitmap.closed));
assert.deepEqual(errors, []);
console.log('PASS leaving the page releases all thumbnail resources without errors');
