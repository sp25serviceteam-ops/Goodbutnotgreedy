import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

// First Crack (/roast/) is a game, but its heat model is real arithmetic and a
// small change to one constant can make every roast unwinnable or unlosable.
// These run whole roasts with no browser and check they end the way they should.
const Model = createRequire(import.meta.url)('../roast/model.js');

function roast(beanId, drive, limit = 1500) {
  const s = Model.create(beanId);
  Model.charge(s);
  while (!s.dropped && s.t < limit) { drive(s, 0.25); Model.step(s, 0.25); }
  if (!s.dropped) Model.drop(s);
  return Model.evaluate(s);
}

test('the autopilot lands a clean roast on every bean', () => {
  for (const bean of Model.BEANS) {
    const r = roast(bean.id, Model.autopilot);
    assert.ok(r.score >= 95, `${bean.name}: scored ${r.score}`);
    assert.deepEqual(r.defects, [], `${bean.name}: no defects`);
    assert.ok(r.total > 9 * 60 && r.total < 13 * 60, `${bean.name}: took ${Math.round(r.total)}s`);
    assert.ok(r.dropT >= bean.target.drop[0] && r.dropT <= bean.target.drop[1], `${bean.name}: dropped at ${r.dropT.toFixed(1)}`);
  }
});

test('full gas with nobody watching ends in a fire', () => {
  const r = roast('huila', s => { s.gas = 1; s.air = 0.1; });
  assert.equal(r.fire, true);
  assert.equal(r.score, 0);
});

test('dropping before first crack is underdeveloped, not a pass', () => {
  const r = roast('guji', s => { s.gas = 0.5; s.air = 0.3; }, 240);
  assert.equal(r.fc, null);
  assert.ok(r.score <= 25, `scored ${r.score}`);
  assert.ok(r.defects.includes('Underdeveloped'));
});

test('too little gas stalls and bakes instead of roasting', () => {
  const r = roast('huila', s => { s.gas = 0.2; s.air = 0.5; }, 1200);
  assert.ok(r.defects.includes('Baked'));
  assert.ok(r.score <= 25, `scored ${r.score}`);
});

test('the build publishes the game and its files', async () => {
  for (const file of ['index.html', 'roast.css', 'model.js', 'app.js']) {
    const body = await readFile(new URL(`../dist/roast/${file}`, import.meta.url), 'utf8');
    assert.ok(body.length > 500, `dist/roast/${file} is published`);
  }
});
