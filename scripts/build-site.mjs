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
  'apple-touch-icon.png', 'favicon.svg', 'wholesale', 'register-interest', 'pricing-preview', 'assets'
]) {
  await cp(join(root, path), join(output, path), { recursive: true });
}
console.log('Static website built in dist. Server source excluded.');
