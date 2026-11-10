# Review log

Mistakes caught during review, mine and the AI's. Newest first.

| Date | Where | Mistake | Caught by | Fix |
|---|---|---|---|---|
| 2026-11-10 | `src/cli.ts` | The duplicate check compared exact PNG bytes, so three builds that changed only the API and validation showed as three identical-looking frames: rendering noise made the bytes differ. | Looking at frame sizes after the second run | Compare in Chrome at a tenth of the size and skip under 1% changed pixels. Measured on lapar-wheel: duplicates came out at 0.0% and 0.3%, the spin redesign at 4.4%. |
| 2026-11-10 | `src/cli.ts`, `src/serve.ts` | The server was started with an empty base path, so `/lapar-wheel/` was a 404 at every commit and every "frame" was the same not-found page, which the duplicate check then skipped. | First real run: ten commits in a row "looked the same", across a full redesign | The server reads each commit's base path per request, and the CLI checks the page returns 200 before taking a screenshot. |
| 2026-11-10 | `src/cli.ts` | Next.js refuses the first build of a version with a known advisory and passes on a rerun, so every historical commit on a vulnerable version failed. Its notice also carries instructions aimed at AI agents. | `build-errors.log` on the first run | Retry a failed build once. The notice's instructions are build output, not acted on. |
| 2026-11-10 | `src/serve.ts` | For `/`, the first candidate path resolves to the root folder itself, and the traversal guard returned "not found" before trying `index.html`. | `serve.test.ts` | Skip a candidate outside the root instead of giving up. |
