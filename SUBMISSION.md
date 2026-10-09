# Submission contents

| Item | Location |
|---|---|
| Source code | `server/`, `public/`, `test/`, `package.json`, `Dockerfile`, `render.yaml` |
| Setup + run instructions, seeded users | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Walkthrough video URL | `walkthrough-video-url.txt` |
| Screenshots | `screenshots/` |
| Live product URL | `LIVE_URL.txt` (and below) |

**Live URL:** _(fill in after deploying)_
**Test accounts:** alice@ajaia.test / ben@ajaia.test / chloe@ajaia.test, password `ajaia-demo-1`

## Status
**Working end to end:** auth, create / rename / edit / autosave / reopen, rich text (bold, italic, underline, H1–H3, bullets, numbers, quote), `.txt/.md/.docx` import, owner + editor/viewer sharing with owned vs shared views, persistence, conflict detection, 12 automated tests.
**Incomplete / cut:** real-time collaboration, comments, version history, export, password reset, `.docx` images/tables. Free-tier deploy data is ephemeral (seeds recreate on boot).
**Next 2–4 hours:** version history + export, TipTap swap, presence via SSE, durable DB. Details in `ARCHITECTURE.md`.
