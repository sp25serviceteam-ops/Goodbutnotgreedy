import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);
// Explicitly publish static website files only. Mail source, tests and docs
// stay outside the public directory; no credentials are written by this build.
for (const path of [
  'index.html', 'privacy.html', 'terms.html', 'site.css', 'podcast.css',
  'payment-pricing.js', 'carepack.png', 'carepack-light.png',
  'apple-touch-icon.png', 'favicon.svg', 'wholesale', 'register-interest', 'assets',
  'roast'
]) {
  await cp(join(root, path), join(output, path), { recursive: true });
}
// No prices on the website (Lukas, 3 Nov 2026: "i think we just don't talk
// pricing on the website"). The old pitch kept at /wholesale/previous/ and the
// old pricing screenshots in pricing-preview/ both show prices, so they stay in
// the repo and are no longer published.
await rm(join(output, 'wholesale', 'previous'), { recursive: true, force: true });
console.log('Static website built in dist. Server source excluded.');
