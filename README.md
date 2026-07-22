# Meridian — deploy as your own web app (with sync)

This folder is a complete, installable web app. Hosting it anywhere that allows
network calls makes cross-device sync (via Pantry) work — unlike the Claude
artifact sandbox, which blocks external requests.

## Deploy on GitHub Pages (free, ~3 minutes)
1. Create a new GitHub repo, e.g. `meridian` (public).
2. Upload ALL files in this folder: index.html, manifest.webmanifest, sw.js,
   icon-192.png, icon-512.png.
3. Repo → Settings → Pages → Source: "Deploy from a branch" → branch `main`,
   folder `/root` → Save.
4. Wait ~1 min. Your app is live at:
   https://lowspeedburt.github.io/meridian/
5. Open that URL on desktop AND phone. On iPhone Safari: Share → Add to Home
   Screen (installs it like a native app, offline-capable).

## Turn on sync
1. Open the app → Data tab → Cloud backend.
2. Paste your Pantry ID → Save ID → Test connection (should say "works" now
   that it's not in the sandbox).
3. Do the same paste on your other device (same Pantry ID).
4. Now: Save on any device pushes; opening any device pulls the latest.

## Alternative hosts (also free, even simpler)
- Netlify: drag this folder onto app.netlify.com/drop — instant URL.
- Cloudflare Pages / Vercel: connect the repo, deploy.
Any static host works; it's just files.
