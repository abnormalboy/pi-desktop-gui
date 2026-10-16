import test from 'node:test';
import assert from 'node:assert/strict';
import { hexColor } from '../scripts/theme-colors.mjs';

test('CSS short/full hex and letter case compare by RGBA, including the minified #fff regression', () => {
  for (const white of ['#fff', '#FFF', '#ffffff', '#FFFFFF', '#ffff', '#FFFFFFFF', ' #fff '])
    assert.equal(hexColor(white), '#ffffffff');
  assert.equal(hexColor('#AbC'), hexColor('#aabbcc'));
  assert.equal(hexColor('#aBc8'), hexColor('#AABBCC88'));
  assert.notEqual(hexColor('#ffe'), hexColor('#fff'));
  assert.notEqual(hexColor('#fff0'), hexColor('#fff'));
  assert.notEqual(hexColor('#ffffff80'), hexColor('#ffffff'));
});

test('Electron ARGB normalization is separate from CSS RGBA and preserves alpha', () => {
  assert.equal(hexColor('#FF18221F', 'electron'), hexColor('#18221f'));
  assert.equal(hexColor('#18221f', 'electron'), hexColor('#18221f'));
  assert.equal(hexColor('#8018221f', 'electron'), hexColor('#18221f80'));
  assert.notEqual(hexColor('#8018221f', 'electron'), hexColor('#18221f'));
  assert.notEqual(hexColor('#FF18221F'), hexColor('#FF18221F', 'electron'));
  assert.notEqual(hexColor('#0018221F', 'electron'), hexColor('#18221f'));
});

test('malformed or unsupported colors fail rather than accidentally matching', () => {
  for (const value of ['', '#ff', '#12345', '#1234567', '#ggg', 'fff', null, undefined])
    assert.throws(() => hexColor(value), /Expected/);
  assert.throws(() => hexColor('#ffff', 'electron'), /Expected/);
  assert.throws(() => hexColor('#fff', 'unknown'), /Unknown/);
});
