import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public share previews reference a packaged, opaque landscape card', async () => {
  const root = new URL('../', import.meta.url);
  for (const page of ['index.html', 'wholesale/index.html', 'register-interest/index.html']) {
    const html = await readFile(new URL(page, root), 'utf8');
    const tags = [...html.matchAll(/<meta\s+[^>]*>/g)].map(match => match[0]);
    const imageTags = tags.filter(tag => /property="og:image"/.test(tag));
    assert.equal(imageTags.length, 1, `${page}: one unambiguous share image`);
    const imageURL = new URL(imageTags[0].match(/content="([^"]+)"/)[1]);
    assert.equal(imageURL.protocol, 'https:');
    const file = await readFile(new URL(`../dist${imageURL.pathname}`, import.meta.url));
    assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(file.readUInt32BE(16), 1200, `${page}: landscape image width`);
    assert.equal(file.readUInt32BE(20), 630, `${page}: landscape image height`);
    assert.equal(file[25], 2, `${page}: RGB, no transparency for dark message backgrounds`);
    assert.ok(tags.some(tag => /name="twitter:card"/.test(tag) && /summary_large_image/.test(tag)));
  }
});
