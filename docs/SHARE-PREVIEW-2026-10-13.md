# Shared website preview

Lukas reported the link preview looked bad and supplied an iMessage screenshot: the transparent black wordmark became unreadable against the dark preview background.

Use the already approved website copy and palette on an opaque 1200x630 RGB PNG. Root, wholesale and registration links reference the versioned image, with Open Graph dimensions/type/alt and a large-image Twitter card. The root metadata also matches the new website copy instead of the retired pricing headline. Runtime cafe routing and logos used inside the site are unchanged. The open cafe-routing PR #2 was checked; it touches separate runtime lines in index.html.

Lukas also reported pulling down past the page top revealed a blank gap. The new landing, registration and confirmation pages disable vertical overscroll on their document/body, with a black document backdrop matching the header. Ordinary scroll and pinch zoom remain available. This does not change the separate cafe tools pages.

- [x] Card rendered from SVG with the existing logo, exact headline and current brand colours.
- [x] Actual image visually checked; no transparent canvas.
- [x] Packaged metadata/PNG regression check and syntax guards pass.
- [x] Browser check at 375px: top remained 0, bottom reached the exact scroll maximum, ordinary scrolling worked, document/body overscroll were none, and no sideways overflow. Pinch zoom remains permitted. Physical iPhone gesture verification is not available from this desktop browser.
- [x] Publish the scoped share-preview fix and verify live assets/metadata.

PR #8 merged as bafc19effd9caa78d67dcc56d8e9f010bf5a0789. Production deploy 6ace08c4b3149e6449dd2fcd is ready and published. Root, wholesale and registration HTML return the new image metadata; the live PNG is 1200x630 RGB, returns image/png and matches the visually checked file byte for byte. The live page at /wholesale/?share=2 reports document/body overscroll none, top/header at 0 and no sideways overflow at 375px. The native iMessage preview on Lukas's phone has not been directly retested; a fresh sharing URL is available if the old card is cached.

Tenant-literal check: this is platform branding and shared-link metadata, with no tenant business logic, pricing rules or accounting changes.
