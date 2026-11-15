# V-Taper Coach

A personal, offline-first training and diet tracker for a 12-week V-taper program. It runs entirely in your browser — no account, no server, no subscription. All your data (settings, workouts, diet log, body measurements) is stored locally on your phone in the browser's built-in database (IndexedDB). Nothing is ever sent anywhere.

It's built to be installed on an iPhone as a home-screen app via Safari, and to keep working even with no signal (e.g. in a gym basement).

This guide assumes you've never used git, GitHub, or deployed a website before. Every step is spelled out.

## 1. Create a free GitHub account

If you don't already have one, go to [github.com/signup](https://github.com/signup) and create a free account.

## 2. Create a new repository

1. Once logged in, click the **+** icon in the top-right corner and choose **New repository**.
2. Give it a name, e.g. `v-taper-coach`.
3. Make sure it's set to **Public** (GitHub Pages' free tier requires a public repo).
4. Don't check any of the "Initialize with..." boxes — leave the repo empty.
5. Click **Create repository**. GitHub will show you a page with setup instructions and a URL that looks like `https://github.com/<your-username>/v-taper-coach.git` — copy that URL, you'll need it next.

## 3. Upload the project files

You have two options — pick whichever feels easier.

### Option A: Using git from a terminal

If you already have this project as a folder on your computer with git set up, open a terminal in that folder and run:

```bash
git remote add origin https://github.com/<your-username>/v-taper-coach.git
git push -u origin main
```

(Replace the URL with the one GitHub gave you in step 2.) Enter your GitHub username and a [personal access token](https://github.com/settings/tokens) when prompted for a password — GitHub no longer accepts your account password for this.

### Option B: Using the GitHub website (no terminal needed)

1. On your new (empty) repository's page, click **uploading an existing file**.
2. Drag the entire project folder's contents into the browser window (or click "choose your files" and select them all — `index.html`, `sw.js`, `manifest.webmanifest`, the `css/`, `js/`, and `icons/` folders, etc.).
3. Scroll down and click **Commit changes**.

Either way, once this is done your repository should show all the project's files.

`tests.html` is a developer-only file (an in-browser pure-function test suite) — it's never linked from the app itself, but if you upload the whole folder it will still be reachable at `/tests.html` on your live site. It's safe to leave it there (it only ever reads/writes a separate, test-only local database, never your real data — see `js/db.js`), but it's just as safe to delete it before uploading if you'd rather not publish it at all.

Because this is a public repository, anything you upload is publicly visible, including `plan.pdf` and `docs/superpowers/specs/plan-source-extract.txt` if they're present in your copy of the project — both contain personal body-metric data, so remove them first (or keep the repository itself private, which disables GitHub Pages' free tier) if you don't want that public.

## 4. Turn on GitHub Pages

1. On your repository's page, click **Settings** (top menu bar of the repo, not your account settings).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose `main` and folder `/ (root)`, then click **Save**.
5. Wait a minute or two. Refresh the Pages settings page — a green box will appear with your site's live URL, which looks like:

   ```
   https://<your-username>.github.io/v-taper-coach/
   ```

## 5. Install it on your iPhone

1. Open **Safari** on your iPhone (it has to be Safari — other browsers can't install home-screen apps on iOS).
2. Go to the URL from step 4.
3. Tap the **Share** icon (the square with an arrow pointing up) in Safari's toolbar.
4. Scroll down and tap **Add to Home Screen**.
5. Tap **Add** in the top-right corner.

You'll now have a V-Taper Coach icon on your home screen that opens full-screen, just like a regular app. The first time you open it online, it caches everything it needs to run — after that, it keeps working even in airplane mode or with no signal.

### Back up your data

Because everything lives only in your phone's local storage, it's a good idea to back it up occasionally. Open the **Settings** tab in the app and use **Export backup** to save a JSON file of all your data, and **Import backup** to restore it (e.g. after getting a new phone). The app will remind you if it's been a while since your last backup.

## Updating the app later

If you come back and change the code (fix a bug, tweak the plan, add a feature), the installed app on your phone won't automatically know new files exist — it aggressively caches everything so it can work offline. To make sure your phone picks up the changes, follow this process on every deploy:

1. Open `sw.js` and find this line near the top:

   ```js
   const CACHE_NAME = 'vtaper-coach-v2';
   ```

   Increase the number at the end by 1 — e.g. if it currently says `v2`, change it to `v3` (next time, `v4`, and so on). This is the one thing you must not forget — without it, your phone will keep serving the old cached files indefinitely, even after you've pushed new code.

2. Commit and push your changes:

   ```bash
   git add -A
   git commit -m "describe what changed"
   git push
   ```

3. Wait a minute for GitHub Pages to rebuild (same as step 4 above — no settings changes needed, it redeploys automatically on every push to `main`).

4. Open the installed app on your phone (with a normal internet connection). It will detect the new service worker version in the background, download and cache the new files, and swap over automatically. If you don't see your change, fully close the app (swipe it away from the app switcher) and reopen it once.

## Project structure

- `index.html`, `manifest.webmanifest` — app shell and PWA metadata.
- `css/styles.css` — all styling (single dark theme).
- `js/app.js` — bootstraps the app: database, first-run setup, tab router, service worker registration.
- `js/db.js` — all IndexedDB access (7 stores: settings, session logs, exercise history, diet log, custom foods, body metrics, check-ins).
- `js/data/plan.js` — the static 12-week training/diet plan data.
- `js/ui/*.js` — one file per tab (Today, Diet, Body, Progress, Settings).
- `js/week.js`, `js/progression.js`, `js/nutrition.js`, `js/checkin.js`, `js/charts.js`, `js/timer.js` — plain logic modules the tabs use (week/phase math, progressive-overload suggestions, nutrition targets, check-in calorie decisions, SVG chart rendering, rest-timer state).
- `sw.js` — the offline service worker (versioned cache-first strategy).
- `tests.html` — an in-browser pure-function test suite (open it directly to run the tests; it isn't part of the deployed app).
