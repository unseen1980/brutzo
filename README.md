# Brutzo

**There's a ghost in your amp. It's brilliant at guitar.**

Brutzo is a browser-based guitar app for blues/rock/pop beginners. Its real-time
assist — *the Ghost* — corrects your pitch and finishes your bends while you play.

## This repo (v0 — marketing site)

- `index.html` — landing page (exported from Claude Design; standalone, loads React + fonts from CDN)
- `design/foundations.html` — the Brutzo design system reference (palette, type, components)

Accent: amber `#FFB020` on near-black stage tones (`#0A0A0B` → `#26262C`), warm grays, off-white `#F2F1EE`.

## Run locally

Just open `index.html` in a browser, or:

    npx serve .

## Deploy

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
Then point `brutzo.com` at it (add a `CNAME` file containing `brutzo.com` and set the DNS A/ALIAS records per GitHub Pages docs).

## TODO before sharing widely

- [ ] Wire the waitlist input to a real endpoint (Formspree/Tally now; Supabase `waitlist` table in Phase 2)
- [ ] Favicon + og:image (1200×630) with the ghost mark
- [ ] Self-host fonts and React bundles (currently CDN) before launch traffic
