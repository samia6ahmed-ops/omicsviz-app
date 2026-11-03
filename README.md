# OmicsViz — App Shell (Phase 1)

This is the unified shell all eight tools will live inside. Right now each
tool route shows a placeholder — migrating the real components is Phase 2.

## What's in here

```
src/
  shared/
    theme.js          the exact LIGHT/DARK tokens from your existing tools
    tools.js           registry of every tool (name, route, icon, status)
    ToolGlyph.jsx       hand-drawn icon per plot type
    Sidebar.jsx         left nav, generated from tools.js
    TopBar.jsx          theme toggle + sign in/out
    AppShell.jsx         page frame (sidebar + topbar + content)
    AuthContext.jsx      Supabase session state (works with or without Supabase configured)
    AuthModal.jsx         sign in / sign up form
    supabaseClient.js     Supabase client (safely null if not configured)
  routes/
    Home.jsx             landing dashboard, card per tool
    ToolPlaceholder.jsx    shown for unmigrated tools
  App.jsx                 router, builds routes from tools.js
```

Add a new tool later by adding one entry to `src/shared/tools.js` — the
sidebar and routing pick it up automatically.

## Run it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Works immediately with no setup — accounts
just show "Accounts (soon)" until you configure Supabase (below).

## Deploy to Vercel (exact steps)

1. Push this folder to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "OmicsViz app shell"
   git branch -M main
   git remote add origin <your-empty-github-repo-url>
   git push -u origin main
   ```
2. Go to https://vercel.com -> Add New... -> Project -> import that repo.
3. Vercel auto-detects Vite. Leave build settings as default (`npm run build`,
   output directory `dist`) and click Deploy.
4. You'll get a live URL (e.g. `omicsviz.vercel.app`) in about a minute.
5. To use a custom domain later: Project -> Settings -> Domains -> add it.

Every `git push` to `main` after this auto-redeploys.

## Turn on accounts (optional, do this whenever you're ready)

1. Go to https://supabase.com -> New project (free tier is fine to start).
2. Once it's created: Project Settings -> API. Copy the Project URL and
   anon public key.
3. Locally, copy `.env.example` to `.env.local` and paste them in:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxxxxxxx
   ```
4. In Vercel: Project -> Settings -> Environment Variables -> add the same two
   keys -> redeploy.
5. Supabase's default email/password auth works out of the box — no extra
   config needed for what's wired up here.

Nothing else in the app needs to change when you add Stripe later — gating
a route just means checking `user` (from `useAuth()`) before rendering it,
the same way you'd check any other permission.

## Phase 2 (next)

Migrate one tool at a time into this shell:
1. Take the tool's JSX, delete its local copy of `LIGHT`/`DARK`/`ThemeCtx`
   and import from `src/shared/theme.js` instead.
2. Drop the component into `src/routes/<ToolName>.jsx`.
3. Swap its route in `App.jsx` from `<ToolPlaceholder>` to the real component.
4. Compile-check + visual check, same as always, before moving to the next.

Suggested order: Volcano -> MA -> PCA -> Heatmap -> Pathway -> Pathway Heatmap ->
Network -> Figure Layout (Figure Layout last since it embeds the others' SVGs).
