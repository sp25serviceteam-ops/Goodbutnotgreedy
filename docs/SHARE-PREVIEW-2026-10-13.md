# Shared website preview

Lukas reported the link preview looked bad and supplied an iMessage screenshot: the transparent black wordmark became unreadable against the dark preview background.

Use the already approved website copy and palette on an opaque 1200x630 RGB PNG. Root, wholesale and registration links reference the versioned image, with Open Graph dimensions/type/alt and a large-image Twitter card. The root metadata also matches the new website copy instead of the retired pricing headline. Runtime cafe routing and logos used inside the site are unchanged. The open cafe-routing PR #2 was checked; it touches separate runtime lines in index.html.

- [x] Card rendered from SVG with the existing logo, exact headline and current brand colours.
- [x] Actual image visually checked; no transparent canvas.
- [x] Packaged metadata/PNG regression check and syntax guards pass.
- [ ] Publish the scoped share-preview fix and verify live assets/metadata.

Tenant-literal check: this is platform branding and shared-link metadata, with no tenant business logic, pricing rules or accounting changes.
