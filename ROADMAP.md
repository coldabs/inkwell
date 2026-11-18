# Inkwell roadmap

Working rule: one feature at a time. A feature is only done when it is confirmed working on a real phone — the builder's check alone is not enough.

## Done

- Unlimited notebooks, handwriting canvas, templates, layers
- PDF import + annotation, scroll reader, annotation-mode page column
- EPUB support (foliate-js), read-aloud, dictionary + Wikipedia lookup
- Text-select highlights + annotation list + Markdown export
- Bookmarks + outline + thumbnails + resume
- Page management (rotate, delete, reorder, extract, merge, split)
- Floating drafting board, focus timer, split screen, bidirectional links
- Stroke engine on perfect-freehand; icon-first UI
- Read-aloud voice picker: few named accents, male/female, working voices only

## Next, in order

1. Full-text search across the whole library
2. Reading themes and typography
3. Parallel Read (two books, synced scroll) — built in the web preview (sync by chapter / page with an offset, by overall position, or off; pairing and places saved); waiting on the real-phone check
4. OCR for scanned PDFs (Tesseract.js; most languages via on-demand language data; about 3–10s per page; print only)
5. Sticky notes (typed notes pinned to a spot)
6. Reading progress and statistics

## After the features

- Android app (the main goal) — Piper offline TTS voice (about 60 MB, download-on-demand) to be decided; note the GPL-3.0 eSpeak NG dependency needs a licence decision
- Website version alongside the app
- PC version later

## Notes

- Many people will use Inkwell on a tablet: larger screens, landscape, stylus.
- AI study tools stay off by default; nothing leaves the device.
- Clean-room only: ideas from open-source readers are fine; no GPL/AGPL code copied.
