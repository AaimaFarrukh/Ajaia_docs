# AI workflow note

## Tools used
- **Claude** (chat) as the primary pair-programmer: scaffolded the server, schema, sanitizer, importers, tests and frontend in one session.
- Playwright (headless Chromium) driven from scripts to exercise the real UI and take screenshots.

## Where AI materially sped things up
- Boilerplate with high correctness requirements but low novelty: scrypt/session handling, route table, SQL schema, CSS system.
- The `.docx` importer (zip central-directory reader + WordprocessingML → HTML), which would have taken me much longer to hand-write.
- Generating a broad test matrix (viewer/editor/non-member cases) quickly.

## What I changed or rejected
- **Rejected** adding a framework + editor library (React/TipTap): it would need `npm install`, complicate review, and eat the timebox. Chose zero-dependency instead and documented the tradeoff.
- **Fixed AI output after verification** (all caught by running things, not reading them):
  - Sanitizer regex swallowed text following a stray `<` (`a < b` lost content): caught by a unit test I wrote for it, fixed the pattern.
  - `hidden` form field still displayed because `.field { display:grid }` overrode it: caught in a screenshot, added a `[hidden]` rule.
  - `node --test test/` fails on Node 22 (directory not accepted): switched to a glob.
  - Library previews repeated the document title; the yellow "shared" marker initially also decorated documents I own: both changed after viewing the screenshot.

## How I verified correctness, UX and reliability
- **Automated:** `npm test`, 12 tests: sanitizer (XSS + stray angle brackets), md/txt/docx import, auth failures, signup validation, owned vs shared lists, viewer 403 / editor 200 / non-member 404, grant + revoke, formatting persistence, stale-write 409, import happy-path and rejection.
- **Browser:** scripted Playwright run: sign in → edit → autosave → reload and confirm bold persisted → sign in as the view-only user and confirm the editor is read-only.
- Reviewed security-sensitive code by hand (auth, access checks, sanitizer) rather than trusting generated output.
