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

assert(js.includes("const COMPENSATION_CODE = '菜鸡ai我原谅你了';"), 'red packet code constant is missing');
assert(js.includes('function initCompensationModal()'), 'compensation modal initializer is missing');
assert(js.includes('copyPlainText(COMPENSATION_CODE)'), 'copy action must reuse plain text clipboard helper');
assert(js.includes("status.textContent = ok ? '已复制' : '复制失败,请长按口令手动复制';"), 'copy status feedback is missing');
assert(js.includes("document.getElementById('compensation-reveal')"), 'reveal button listener is missing');
assert(js.includes("document.getElementById('compensation-dismiss')"), 'dismiss button listener is missing');

assert(css.includes('.compensation-image'), 'compensation image CSS is missing');
assert(css.includes('max-width: min(100%, 360px);'), 'compensation image rendered width must be capped');
assert(css.includes('aspect-ratio: 3 / 2;'), 'compensation image must preserve 3:2 ratio');

const size = pngSize(imagePath);
assert.deepStrictEqual(size, { width: 960, height: 640 }, 'compensation image must be 960x640');

console.log('compensation modal static checks passed');
