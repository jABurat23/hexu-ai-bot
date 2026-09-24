# 🤖 Hexu AI — Messenger Bot

<div align="center">
  <img src="public/logo.png" width="150" height="150" alt="Hexu AI Logo" />
  <p><strong>An Intelligent, Role-Based Facebook Messenger Chatbot</strong></p>
</div>

---

## 📖 About

**Hexu AI** is a Facebook Messenger chatbot designed for the Hexu AI Page. It is built as a modular Node/Express application backed by Supabase and Google's Gemini.

### Key Features
- **🤖 `!ai` Command**: Ask Gemini anything with `!ai <question>`. Conversation context is kept per user (in-memory cache + Supabase) so it remembers the last several turns, rate-limited to 10 requests/min per user.
- **⚡ Command System**: Responds to `!`-prefixed text commands (e.g. `!ping`, `!help`). Each command lives in its own file in `commands/`, automatically discovered and cached on startup by `lib/commandLoader.js` — no manual registration.
- **🔄 Hot Reload**: `!reload` (ADMIN+) re-scans `commands/` on demand, so new or edited command files go live without a restart.
- **🛡️ Role-Based Access Control (RBAC)**: Supports four permission tiers (👑 `OWNER`, 💻 `DEVELOPER`, 🛡️ `ADMIN`, 👤 `USER`), allowing you to secure powerful commands.
- **📊 Live Dashboard**: `/dashboard` shows uptime, command/queue/AI stats in real time, optionally gated behind `DASHBOARD_TOKEN`.
- **💤 Keep-Alive**: Self-pings the deployed URL every few minutes to avoid Render free-tier spin-down.
- **✨ Premium Landing Page**: A beautifully designed, glassmorphic landing page served on the root endpoint.

---

## 📂 Project Structure

```text
├── index.js                  # App bootstrap: Express server, static files, and routes
├── config.js                 # Centralized environment variable validation
├── routes/
│   ├── webhook.js            # GET verification, POST signature check, in-memory dedup
│   └── dashboard.js          # Live /dashboard stats page + JSON API
├── services/
│   └── messageService.js     # Core logic: parses commands, routes unmatched text to !help
├── lib/
│   ├── gemini.js              # Gemini API wrapper, powers the !ai command
│   ├── commandLoader.js       # Recursive command scan, caching, hot reload
│   ├── messenger.js           # Meta Send API wrapper (text, buttons, typing, reactions)
│   ├── reaction.js            # Reaction helper (⏳ pending / ✅ done / ❌ error)
│   ├── moderation.js          # Shared moderation helpers (block/warn logic)
│   ├── roles.js                # RBAC logic, hierarchy, and emojis
│   └── supabase.js             # User, message history, role, and moderation storage
├── commands/
│   ├── index.js               # Bridge — delegates to lib/commandLoader.js
│   ├── ai.js                  # !ai — Gemini-backed, rate-limited
│   ├── help.js                 # Lists all commands grouped by role, or filters by category
│   ├── reload.js               # ADMIN+ hot-reload of commands/ without a restart
│   ├── ping.js                  # Checks bot latency and DB connection
│   ├── profile.js               # Displays user PSID and role
│   └── setrole.js               # 👑 OWNER ONLY: Promote/demote users
├── utils/
│   ├── logger.js                # Timestamped, color-coded logger with per-message trace IDs
│   ├── metrics.js                # In-memory counters surfaced by !status and /dashboard
│   ├── messageQueue.js           # Bounded concurrency queue for webhook events
│   ├── contextCache.js           # In-memory !ai conversation context (LRU, 100 users)
│   └── keep-alive.js             # Self-ping to avoid Render free-tier spin-down
├── public/
│   └── logo.png               # The bot's logo for the landing page
├── supabase-schema.sql        # SQL table definitions (includes migrations)
└── .env.example                # Example environment variables
```

---

## 🚀 Setup & Installation

### 1. Supabase Database
1. Create a new Supabase project (or use an existing one).
2. Go to the **SQL Editor**, paste the contents of `supabase-schema.sql`, and run it. It's safe to re-run on an existing database — table creation uses `IF NOT EXISTS` and the `source` column migration uses `ADD COLUMN IF NOT EXISTS`.
3. Grab your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Project Settings → API.

### 2. Local Setup
```bash
npm install
cp .env.example .env
```
Fill in the `.env` file with your actual keys. Be sure to set `OWNER_PSID` to your own Messenger ID so you automatically receive 👑 OWNER privileges on your first message!

```bash
npm run dev
```
The server starts on `http://localhost:3000`. The root URL displays the premium landing page.

### 3. Deploying (Render)
1. Push this project to a GitHub repo.
2. On Render: **New → Web Service** and connect the repo.
3. Build command: `npm install` | Start command: `npm start`
4. Add all variables from your `.env` to Render's Environment tab.
5. Deploy! Your webhook URL will be `https://<your-render-service>.onrender.com/webhook`

### 4. Meta Webhook Configuration
1. Go to **Meta for Developers → Messenger → Settings → Webhooks**.
2. **Callback URL**: The Render URL from Step 3.
3. **Verify Token**: Must match your `WEBHOOK_VERIFY_TOKEN` in `.env`.
4. Subscribe to: `messages` and `messaging_postbacks`.

For production deployments, set `NODE_ENV=production` and provide `APP_SECRET`.
The application will refuse to start without it because webhook signature
verification is required outside local development. Run the updated
`supabase-schema.sql` to create the `processed_messages` table, which prevents
duplicate Meta deliveries from producing duplicate replies.

---

## 🛠️ Adding Features

- **New Command**: Create a new file in `commands/` (e.g., `commands/weather.js`). Export `{ name, description, requiredRole, handler }`. The system will automatically register it and secure it based on `requiredRole`.
- **New API Integration**: Add your helper logic to the `lib/` directory and import it inside your new command.

Built-in utility commands include `!about`, `!status`, `!history`, and
`!clearhistory CONFIRM`. `!clearhistory` requires ADMIN access or higher.
`!history` shows only `!ai` conversation turns (tagged `source='ai'` in
Supabase) — there is deliberately no user-facing way to wipe `!ai` context;
`!clearhistory` (ADMIN+) is the only way to clear stored messages, and it
still doesn't touch the user's profile or role.

`!ai <question>` asks Gemini, keeping per-user context in an in-memory
LRU cache (100 users, 20 turns each) backed by Supabase, with a 10
requests/minute rate limit and a 6s per-command cooldown. Set
`GEMINI_API_KEY` to enable it; without a key the command fails gracefully
with an apology rather than crashing. A plain message that doesn't match
any command now gets a short `!help` pointer — there's no automatic AI
fallback for unstructured text.

`!reload` (ADMIN+) re-scans `commands/` on disk and hot-swaps the command
registry without restarting the process — useful right after editing or
adding a command file. It skips the rescan if nothing changed unless you
run `!reload force`.

Additional commands include `!uptime`, `!uid`, and the ADMIN-only `!users`
command. `!menu` is an alias for `!help`; command listings are grouped by
category and filtered by the caller's role.

Commands can define `aliases`, `category`, `usage`, `requiredRole`, and
`cooldownSeconds`. Webhook work is processed through a bounded queue configured
with `QUEUE_MAX_SIZE` and `QUEUE_CONCURRENCY`, and the server drains active
work during graceful shutdown. An in-memory Set also catches duplicate Meta
webhook deliveries before they reach the queue (10s TTL), with the existing
`processed_messages` table in Supabase as a second line of defense across
restarts. Runtime counters are included in `!status` and `/dashboard`.

Moderation commands include ADMIN-only `!block`, `!unblock`, `!warn`, and
`!warnings`, plus OWNER-only `!clearwarnings`. Run the expanded
`supabase-schema.sql` to create the moderation tables and audit log.

Messenger postbacks with `GET_STARTED` or `HELP` open `!help`. A postback
payload beginning with `CMD:` can safely invoke a command, such as
`CMD:!status`. Unsupported attachments receive a guidance response, while
delivery, read, and reaction events are logged without triggering any work.

`!weather <city>` uses Open-Meteo's geocoding and forecast APIs and does not
require an additional API key. Requests use `REQUEST_TIMEOUT_MS` and the
command has a per-user cooldown. `!rules` displays the bot's usage guidance.

`/dashboard` shows live uptime, command, message, queue, AI, and keep-alive
stats (server-side cached for 10s, client auto-refreshes every 15s with a
manual refresh button). Set `DASHBOARD_TOKEN` to require `?token=...` before
sharing the link anywhere public — it's open by default.

The bot self-pings its own `RENDER_EXTERNAL_URL` (set automatically by
Render) every few minutes via `utils/keep-alive.js`, to avoid the free
tier's 15-minute idle spin-down. This is a community workaround, not an
officially supported fix — set `KEEP_ALIVE=false` to disable it.

---

## 🤝 Contributing

Contributions are always welcome! 
- Open a **pull request** with your change.
- Or reach out directly at **kisakitetta852@gmail.com** if you'd like to get involved as a developer or maintainer.