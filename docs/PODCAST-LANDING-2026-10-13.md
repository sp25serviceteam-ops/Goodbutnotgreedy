# Podcast landing and registration

## Decisions, 13 October 2026

- Lukas asked for pages 1, 4 and 5 of the pitch combined into one public landing page ahead of Thursday's podcast, with wording reviewed before visuals.
- Stock management is a primary message, including the opening copy.
- Customer perks include partnerships with trainers, parts suppliers and technicians.
- Connections and developing with customers share one section.
- Shopify, Slack, Cropster and MYOB sit under "Currently building". Xero and Stripe remain separate.
- Register interest opens a dedicated submission page. The header button remains visible while scrolling.
- Footer contact: "Or email me: lukas@cafecarepackage.com".
- Every form answer is emailed to Lukas, with the registrant as Reply-to. His latest direction allows the easier email route: "if theres a easier way to set up emails just use my own email to email myse;f". Native Netlify form notifications deliver to his existing mailbox.
- Restore the original Lukas photo/bio under Want a demo; link Lukas and head developer Mike Palmer to the exact supplied LinkedIn profiles.
- The top navigation/header is black, retaining the original white/green logo.
- Live publication approved: "cool do that, lets finish this site". The page is the main public website; cafe tools and existing customer links remain available.

## Checklist

- [x] Read pitch and current website; read product/copy/design rules.
- [x] Isolated marketing checkout and branch; ordering site untouched.
- [x] Desktop and phone landing with persistent registration link.
- [x] Dedicated registration page, optional customer count/not applicable, required contact fields.
- [x] Native Netlify Forms storage and actual form detection checked on preview.
- [x] Registration-only email notification configured to lukas@cafecarepackage.com.
- [x] Full submitted answers and Reply-to verified in the actual notification in Lukas's inbox.
- [x] Publish only static assets in dist; docs and scripts excluded.
- [x] Existing wholesale page preserved at /wholesale/previous/ with noindex and its form return path updated.
- [x] Current root cafe routing, customer links, sign-in routes, privacy and terms retained.
- [x] Final screenshots and click pass at 1440px and 375px; no sideways overflow; 16px form inputs; photo loads when scrolled into view.
- [x] Actual labelled test registration saved and confirmation reached on hosted preview.
- [x] Lukas approves the concrete preview for live publication.
- [x] Publish only this marketing change and verify public registration end to end.

## Hosting and email

Marketing repository: sp25serviceteam-ops/Goodbutnotgreedy.
Marketing Netlify project: goodbutnotgreedy, 2a9e882c-9981-42fe-a721-29071e69ba4a.
Main in this repository publishes the public website; do not merge without approval.

Preview: https://podcast-oct15-preview--goodbutnotgreedy.netlify.app/wholesale/
Registration page: /register-interest/.
Previous wholesale landing: /wholesale/previous/.

Form: care-pack-interest, ID 6acdfee4cb973ac841b2a32d.
Notification: 6ace018156ac894e6e12c7e3, submission_created, email, scoped to that form only.
Recipient: lukas@cafecarepackage.com. Sender: formresponses@netlify.com.
The existing site-wide notification to lukas@kiness.com.au was retained.
No Postmark/Gmail credentials, custom mail functions or account changes are required.

## Actual end-to-end proof, 13 October

One clearly labelled TEST ONLY submission was entered through the hosted form, including a zero customer count. The browser reached /register-interest/thanks/ and Netlify reported one saved submission. Gmail showed "New Care Pack registration (1)" in lukas@cafecarepackage.com's Inbox. Its body contained name, business name, business type, email, accounting software, customer count 0, interest All and the full message. Reply-To matched the submitted email. This is an actual delivery check, not a mocked mail-provider test.

Publication: PR #6 merged as 49dd2236ce15ce64a34b46f540f6a40cea95d270. Netlify production deploy 6ace0411ad409298311024a2 is ready and was published on 13 October at 21:12 Sydney time. Opening https://cafecarepackage.com reached the approved page at /wholesale/. The previous page was opened at /wholesale/previous/.

A second labelled LIVE WEBSITE TEST was submitted on the real domain at phone width. It reached the confirmation page and increased the form's saved count to two. Gmail received "New Care Pack registration (2)" with General consumer, Customers Not Applicable: Yes, Stock management and the full message; blank optional answers stayed blank. The live page had no sideways overflow at 375px and the black header remained visible. The test record is clearly labelled; no real prospect data or ordering-platform state was changed.

The local preview refuses to claim a registration was saved, because it has no form backend. Hosted registration uses Netlify's form processing and goes to confirmation only after an accepted response. Forms are stored independently of notification delivery. No email is sent to the visitor.

## Bio and tenant scope

Mike's supplied LinkedIn link opened a sign-in wall. His draft bio describes only the head developer role Lukas provided, without career history or credentials inferred from unrelated namesake profiles.

Tenant-specific literal check: this is a platform marketing page, not shared tenant product logic. Care Pack identity and Lukas's explicitly requested inbox are intentional platform branding/contact configuration. No roaster/customer/country/currency/tax rules were introduced.
