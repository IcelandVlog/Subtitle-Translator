# This repo contains two separate projects

These got tangled together in a bad git merge and have now been split apart
into their own folders so they can be deployed independently:

- **`subtitle-translator/`** — the real Next.js subtitle translation app
  (translates subtitles into 120+ languages, progress bar, ZIP download).
  This is almost certainly the app you want live on Vercel.
- **`strip/`** — an unrelated Vite app that extracts audio/subtitle tracks
  out of video files. No translation feature.

## Deploying `subtitle-translator/` to Vercel

In Vercel project settings, set **Root Directory** to `subtitle-translator`
(Settings → General → Root Directory). Framework preset: Next.js. Then
redeploy.

## Deploying `strip/` to Vercel (if you want it too)

Create a **separate** Vercel project pointing at the same repo, with
**Root Directory** set to `strip`. Framework preset: Vite.
