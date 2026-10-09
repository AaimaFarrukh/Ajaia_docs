# Ajaia Docs

A lightweight collaborative document editor: create and edit rich-text documents, import files, and share with teammates (editor or view-only). Real authentication, SQLite persistence, **zero npm dependencies**.

## Run locally (2 commands)

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`). No `npm install` needed.

```bash
npm start          # http://localhost:3000
npm test           # 12 automated tests
```

On first start the database (`./data/ajaia.db`) is created and seeded.

### Seeded accounts (password for all: `ajaia-demo-1`)

| User | Email | What to look at |
|---|---|---|
| Alice Moreno | alice@ajaia.test | Owns "Q4 launch plan" (shared with Ben as editor, Chloe as viewer) |
| Ben Okafor | ben@ajaia.test | Owns the onboarding checklist, edits Alice's plan |
| Chloe Tanaka | chloe@ajaia.test | View-only on Alice's plan; owns a private "Interview notes" doc |

You can also create your own account on the sign-in screen.

### Two-minute review path
1. Sign in as **Alice** → open *Q4 launch plan* → edit (bold, headings, lists). Watch "Saving… / Saved".
2. Click **Share** → add `chloe@ajaia.test` or change Ben's role.
3. In a second browser window / private window, sign in as **Ben** (can edit, sees Alice's edits within ~5 s) and **Chloe** (read-only, toolbar disabled).
4. On the Documents page, **Import file** with a `.txt`, `.md` or `.docx` → becomes a new editable document.
5. Notice the yellow marker and "From …" on documents shared *with* you; "Shared with N" on documents you own and shared.

## Features
- **Documents**: create, rename (click the title), edit, autosave (700 ms debounce, Ctrl/Cmd+S flushes), reopen, delete (owner).
- **Rich text**: bold, italic, underline, Heading 1–3, bulleted/numbered lists, quote, undo/redo. Pasting is plain text by design.
- **Import**: `.txt`, `.md`, `.docx` (≤ 5 MB) → new document. Stated in the UI. `.docx` keeps headings, bold/italic/underline and lists; images and tables are not imported.
- **Sharing**: owner grants `editor` or `viewer` by email (account must exist); change role / remove any time. Owned vs shared are separated by tabs, labels and a highlighter-yellow marker.
- **Auth**: email + password, scrypt hashing, random session tokens (hashed in DB), HttpOnly SameSite=Lax cookie, login rate limiting, constant-time failure path.
- **Safety**: server-side allow-list HTML sanitizer, strict CSP, 404 (not 403) for documents you can't see.
- **Concurrency**: optimistic check on save; if a teammate saved first you get a banner with *Load their version* / *Keep mine*. Idle tabs poll every 5 s to pick up teammate edits.

## Deploy

**Docker (anywhere):**
```bash
docker build -t ajaia-docs . && docker run -p 8080:8080 -v ajaia-data:/data ajaia-docs
```

**Render (free, no card):** push this folder to a GitHub repo → Render → *New → Blueprint* → pick the repo (`render.yaml` is included). Free instances have an ephemeral disk, so data resets on redeploy/idle restart, and the seed accounts are recreated automatically, so reviewers always get a working demo. For durable data, attach a disk and set `DB_PATH=/data/ajaia.db`.

Env vars: `PORT` (3000), `DB_PATH` (`./data/ajaia.db`), `SEED=0` to skip seeding, `COOKIE_SECURE=1` when served over HTTPS (set in `render.yaml`).

## Layout
```
server/  app.js (routes, access control) · auth.js · db.js · sanitize.js · importers.js · seed.js
public/  index.html · styles.css · app.js (vanilla SPA, hash router)
test/    units.test.js (sanitizer, md/txt/docx import) · api.test.js (auth, sharing, persistence, conflicts)
```

## Known limits
See `ARCHITECTURE.md` ("Deliberately cut" and "Next 2–4 hours").
