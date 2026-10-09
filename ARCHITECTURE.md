# Architecture note

## What I prioritized and why
The brief rewards depth in a few areas, so I put the effort where a reviewer would actually poke: **access control, persistence correctness, and the editing/save loop**, not feature count.

1. **Trustworthy sharing.** Every document route goes through one `requireDoc(id, user, minimum)` check (owner / editor / viewer). Users without access get 404, identical to "doesn't exist". Tests cover viewer-can't-write, editor-can-write, non-members-can't-see, revoke, and owner-only share management.
2. **A save loop that doesn't lose work.** Autosave is debounced, serialized (one request in flight), retries when offline, warns on tab close, and uses an optimistic `baseUpdatedAt` check so two editors can't silently overwrite each other. Last-writer-wins would have been simpler; the conflict banner is cheap and visibly more correct.
3. **Stored content is safe and portable.** Documents are stored as a tiny attribute-free HTML subset (`p h1-h3 ul ol li b i u br blockquote`). The server sanitizes on every write, so a malicious client can't store script, and import output goes through the same path.
4. **Real auth, not a switcher.** Scrypt + server-side sessions so sharing is demonstrable with genuinely separate identities.
5. **Zero runtime dependencies.** Node's `http`, `node:sqlite`, `crypto`, `zlib`. Reviewers run it with no install step and nothing to audit or pay for. The cost: I wrote a small router, a minimal `.docx` reader and a sanitizer rather than using libraries (all unit-tested).

## Stack
| Layer | Choice | Why |
|---|---|---|
| Server | Node 22 `http` | No install, fast to read |
| DB | SQLite (`node:sqlite`, WAL, FKs on) | Relational sharing model, trivial to run and deploy |
| Editor | `contenteditable` + `execCommand` | Fast, native undo/redo and shortcuts. Deprecated but universally supported; see tradeoffs |
| UI | Vanilla JS SPA, hash routes | One file per concern; no build step |

## Data model
`users` · `sessions(token_hash)` · `documents(owner_id, title, content, updated_at, updated_by)` · `shares(doc_id, user_id, role)` with `PRIMARY KEY (doc_id, user_id)` and cascades.

## API (JSON, cookie auth)
`POST /api/auth/{signup,login,logout}` · `GET /api/me` · `GET/POST /api/docs` · `GET/PATCH/DELETE /api/docs/:id` · `GET/POST /api/docs/:id/shares` · `DELETE /api/docs/:id/shares/:userId` · `POST /api/import` (raw bytes + `x-filename`)

## Tradeoffs I made on purpose
- **`execCommand` over TipTap/ProseMirror.** A real editor framework is the right call for production (schema, collab, comments). Within the timebox and a no-dependency constraint, `contenteditable` delivered a coherent editing experience. Swapping the editor means replacing one component; storage format is already plain HTML.
- **HTML as storage format** rather than a JSON doc model: simplest thing that preserves formatting and is trivially exportable.
- **Polling instead of websockets** for teammate updates: 5 s, only when the tab has no unsaved changes. Not real-time collaboration, but honest and robust.
- **Import by raw-body upload** instead of multipart: avoids a parser dependency; size-capped at 5 MB.
- **Sharing requires an existing account** (no email invites) to avoid pretending to send mail.

## Deliberately cut
Real-time cursors / OT-CRDT, comments, version history, export, password reset & email verification, images/tables in the editor, `.docx` images/tables on import, per-document link sharing, CSRF tokens (mitigated by SameSite=Lax + JSON-only mutations + custom header on import), durable hosted DB on the free deploy.

## Next 2–4 hours
1. Version history (snapshot on save every N minutes, restore) and Markdown/PDF export.
2. Swap the editor for TipTap with the same HTML storage; add comments.
3. Presence indicators ("Ben is editing") via SSE; replace polling.
4. Postgres/Litestream for durable hosting; e2e Playwright suite in CI.
