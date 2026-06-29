const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/app-load-smooth.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const imagePath = path.join(root, 'public/assets/ai-compensation-red-packet.png');

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.toString('ascii', 1, 4), 'PNG', 'asset must be a PNG file');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

assert(html.includes('id="compensation-stage"'), 'compensation dialog stage is missing');
assert(html.includes('id="compensation-image"'), 'compensation image is missing');
assert(html.includes('assets/ai-compensation-red-packet.png'), 'compensation image path is missing');
assert(html.includes('width="960"'), 'compensation image width attribute must constrain intrinsic layout');
assert(html.includes('height="640"'), 'compensation image height attribute must constrain intrinsic layout');
assert(html.includes('id="compensation-dismiss"'), 'dismiss button is missing');
assert(html.includes('id="compensation-reveal"'), 'reveal button is missing');
assert(html.includes('id="compensation-copy"'), 'copy button is missing');
assert(html.includes('id="compensation-code-panel"'), 'red packet code panel is missing');
assert(html.includes('styles.css?v=20260630-compensation-close'), 'stylesheet cache key must change for close-state fix');
assert(html.includes('app-load-smooth.js?v=20260630-compensation-close'), 'script cache key must change for close-state fix');

assert(js.includes("const COMPENSATION_CODE = '菜鸡ai我原谅你了';"), 'red packet code constant is missing');
assert(js.includes('function initCompensationModal()'), 'compensation modal initializer is missing');
assert(js.includes('function hasCompensationBeenSeen()'), 'persistent seen check helper is missing');
assert(js.includes("localStorage.getItem(COMPENSATION_STORAGE_KEY)"), 'seen state must be checked in localStorage');
assert(js.includes("localStorage.setItem(COMPENSATION_STORAGE_KEY, '1')"), 'seen state must be persisted in localStorage');
assert(js.includes("sessionStorage.setItem(COMPENSATION_STORAGE_KEY, '1')"), 'seen state must keep a sessionStorage fallback');
assert(js.includes('copyPlainText(COMPENSATION_CODE)'), 'copy action must reuse plain text clipboard helper');
assert(js.includes("status.textContent = ok ? '已复制' : '复制失败,请长按口令手动复制';"), 'copy status feedback is missing');
assert(js.includes("document.getElementById('compensation-reveal')"), 'reveal button listener is missing');
assert(js.includes("document.getElementById('compensation-dismiss')"), 'dismiss button listener is missing');
assert(js.includes('function handleCompensationRevealAction()'), 'reveal button must use a stateful click handler');
assert(js.includes("reveal.textContent = '关闭';"), 'revealed state must relabel the right action as close');
const handlerStart = js.indexOf('function handleCompensationRevealAction()');
const handlerEnd = js.indexOf('async function copyCompensationCode', handlerStart);
const handlerBody = js.slice(handlerStart, handlerEnd);
assert(handlerBody.includes('!panel.hidden'), 'reveal action must detect already revealed panel state');
assert(handlerBody.includes('closeCompensationModal();'), 'revealed right action must close the modal');

const initStart = js.indexOf('function initCompensationModal()');
const initEnd = js.indexOf('function flashDebateButton', initStart);
const initBody = js.slice(initStart, initEnd);
assert(initBody.includes('if (hasCompensationBeenSeen()) return;'), 'initializer must skip users who already saw the modal');
assert(initBody.indexOf('setCompensationSeen();') > -1, 'initializer must mark the modal seen when it is scheduled');
assert(
  initBody.indexOf('setCompensationSeen();') < initBody.indexOf('stage.classList.add'),
  'modal must be marked seen before opening so reveal/copy/reload cannot show it again'
);
assert(
  initBody.includes("document.getElementById('compensation-reveal')?.addEventListener('click', handleCompensationRevealAction);"),
  'reveal button listener must use the stateful reveal/close handler'
);

assert(css.includes('.compensation-image'), 'compensation image CSS is missing');
assert(css.includes('max-width: min(100%, 360px);'), 'compensation image rendered width must be capped');
assert(css.includes('aspect-ratio: 3 / 2;'), 'compensation image must preserve 3:2 ratio');

const size = pngSize(imagePath);
assert.deepStrictEqual(size, { width: 960, height: 640 }, 'compensation image must be 960x640');

console.log('compensation modal static checks passed');
