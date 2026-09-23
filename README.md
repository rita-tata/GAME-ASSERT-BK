# ASSERT — GitHub Pages + Netlify

Package prepared for the ASSERT game. The same repository can be used for both:

- GitHub Pages: serves `index.html` as the student game.
- Netlify: runs `netlify/functions/assert-data.mjs` and stores student progress in Netlify Blobs.

## IMPORTANT — one URL replacement

Before the GitHub Pages version can sync to Netlify, replace this placeholder in `index.html`:

`https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/assert-data`

with the real Netlify site URL, for example:

`https://assert-bk-xxxxx.netlify.app/.netlify/functions/assert-data`

Do not change the `/.netlify/functions/assert-data` part.

## Netlify environment variable

In Netlify Project configuration → Environment variables, create:

`ASSERT_BK_CODE`

Value:

`ASSERT-BK`

Use the same code as the Teacher Room login in the game.

## Deployment order

1. Create a GitHub repository and upload the contents of this folder.
2. Deploy that GitHub repository to Netlify.
3. Set `ASSERT_BK_CODE` to `ASSERT-BK`.
4. Copy the Netlify site URL.
5. Replace `YOUR-NETLIFY-SITE` in `index.html` with the real Netlify site name.
6. Commit the changed `index.html` to GitHub.
7. Enable GitHub Pages from the `main` branch and `/ (root)`.
8. Test the game from the GitHub Pages URL. Student data should appear in Ruang Guru BK after logging in with `ASSERT-BK`.

## Store

The function uses the site-wide Netlify Blobs store:

`assert-student-data-v15-clean`

Student records are stored one record per student name so simultaneous students do not overwrite one shared JSON file.

## Files

- `index.html` — ASSERT game
- `netlify.toml` — Netlify configuration
- `package.json` — Netlify Blobs dependency
- `netlify/functions/assert-data.mjs` — online student-data API
