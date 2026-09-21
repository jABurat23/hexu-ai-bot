# 🤖 Hexu AI — Messenger Bot

<div align="center">
  <img src="public/logo.png" width="150" height="150" alt="Hexu AI Logo" />
  <p><strong>An Intelligent, Role-Based Facebook Messenger Chatbot</strong></p>
</div>

---

## 📖 About

**Hexu AI** is a Facebook Messenger chatbot designed for the Hexu AI Page. It is built as a modular Node/Express application backed by Supabase and Anthropic's Claude.

### Key Features
- **🤖 AI Fallback**: If a user sends a normal message, the bot remembers the last 20 messages (via Supabase) and generates a smart reply using Claude.
- **⚡ Command System**: Responds to `!`-prefixed text commands (e.g. `!ping`, `!help`). Each command lives in its own file in `commands/`, automatically loaded on startup!
- **🛡️ Role-Based Access Control (RBAC)**: Supports four permission tiers (👑 `OWNER`, 💻 `DEVELOPER`, 🛡️ `ADMIN`, 👤 `USER`), allowing you to secure powerful commands.
- **✨ Premium Landing Page**: A beautifully designed, glassmorphic landing page served on the root endpoint.

---

## 📂 Project Structure

```text
├── index.js                  # App bootstrap: Express server, static files, and routes
├── config.js                 # Centralized environment variable validation
├── routes/
│   └── webhook.js            # GET verification & POST signature check for Meta
├── services/
│   └── messageService.js     # Core logic: parses commands vs AI fallback
├── lib/
│   ├── claude.js             # Claude API wrapper for AI fallback replies
│   ├── messenger.js          # Meta Send API wrapper (text, buttons, typing)
│   ├── reactions.js          # Reaction helper (⏳ pending / ✅ done / ❌ error)
│   ├── roles.js              # RBAC logic, hierarchy, and emojis
│   └── supabase.js           # User, message history, and role management
├── commands/
│   ├── index.js              # Auto-loads and executes commands based on role
│   ├── help.js               # Lists all commands grouped by role
│   ├── ping.js               # Checks bot latency and DB connection
│   ├── profile.js            # Displays user PSID and role
│   └── setrole.js            # 👑 OWNER ONLY: Promote/demote users
├── public/
│   └── logo.png              # The bot's logo for the landing page
├── supabase-schema.sql       # SQL table definitions
└── .env.example              # Example environment variables
```

---

## 🚀 Setup & Installation

### 1. Supabase Database
1. Create a new Supabase project (or use an existing one).
2. Go to the **SQL Editor**, paste the contents of `supabase-schema.sql`, and run it to create the `users` and `messages` tables.
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
History commands only access the requesting user's messages; clearing history
does not delete the user's profile or role.

Additional commands include `!uptime`, `!uid`, and the ADMIN-only `!users`
command. `!menu` is an alias for `!help`; command listings are grouped by
category and filtered by the caller's role.

Commands can define `aliases`, `category`, `usage`, `requiredRole`, and
`cooldownSeconds`. Webhook work is processed through a bounded queue configured
with `QUEUE_MAX_SIZE` and `QUEUE_CONCURRENCY`, and the server drains active
work during graceful shutdown. Runtime counters are included in `!status`.

Moderation commands include ADMIN-only `!block`, `!unblock`, `!warn`, and
`!warnings`, plus OWNER-only `!clearwarnings`. Run the expanded
`supabase-schema.sql` to create the moderation tables and audit log.

Messenger postbacks with `GET_STARTED` or `HELP` open `!help`. A postback
payload beginning with `CMD:` can safely invoke a command, such as
`CMD:!status`. Unsupported attachments receive a guidance response, while
delivery, read, and reaction events are logged without triggering AI work.

`!weather <city>` uses Open-Meteo's geocoding and forecast APIs and does not
require an additional API key. Requests use `REQUEST_TIMEOUT_MS` and the
command has a per-user cooldown. `!rules` displays the bot's usage guidance.

---

## 🤝 Contributing

Contributions are always welcome! 
- Open a **pull request** with your change.
- Or reach out directly at **kisakitetta852@gmail.com** if you'd like to get involved as a developer or maintainer.