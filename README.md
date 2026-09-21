# Hexu AI — Messenger Bot

## About

**Hexu AI** is a Facebook Messenger chatbot for the Hexu AI Page. It responds
to `!`-prefixed text commands (e.g. `!ping`, `!help`), falls back to a
Claude-powered AI reply for anything else once an Anthropic key is added,
and keeps per-user conversation history in Supabase. It's built as a small
Node/Express app deployed on Render, with each command living in its own
file so new ones are easy to add without touching existing code.

## Table of Contents

- [About](#about)
- [Project Structure](#project-structure)
- [Setup](#setup)
  - [1. Supabase](#1-supabase)
  - [2. Local Setup](#2-local-setup)
  - [3. Deploy to Render](#3-deploy-to-render)
  - [4. Finish the Meta Webhook Setup](#4-finish-the-meta-webhook-setup)
- [Adding Features](#adding-features)
- [Contributing](#contributing)

## Project Structure

```
index.js                    App bootstrap: creates the Express app, mounts routes, listens
config.js                    Reads + validates env vars in one place; exits with a clear
                              error if something required is missing
routes/webhook.js            GET verification + POST signature check, then hands off
                              each event to the message service
services/messageService.js   The actual "what happens when a message arrives" logic:
                              command vs. AI fallback, plus command reactions
lib/messenger.js             Send API wrapper (text, button templates, typing, reactions)
lib/reactions.js              Reaction helper (⏳ pending / ✅ done / ❌ error on commands)
lib/claude.js                 Claude API wrapper for AI fallback replies
lib/supabase.js               User + message history storage
commands/index.js             The bridge — auto-loads every command file in this folder,
                              has no command logic of its own
commands/ping.js               Example command: bot status + API/DB latency
commands/help.js               Example command: lists all commands, or details on one
utils/logger.js                Timestamped, color-coded logger with per-message trace IDs
supabase-schema.sql            Tables to create in Supabase
.env.example                    Env vars you need (copy to .env for local dev)
.gitignore                      Keeps node_modules/ and .env out of git
```

## Setup

### 1. Supabase

1. Open your Supabase project (new one, or the existing Classboard project).
2. Go to SQL Editor, paste the contents of `supabase-schema.sql`, run it.
3. Grab your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
   Project Settings → API. Use the **service role** key (not the anon key)
   since this server runs with full trust, not per-user auth.

### 2. Local Setup

```bash
npm install
cp .env.example .env
# fill in .env with your real values
npm run dev
```

The server starts on `http://localhost:3000`. `GET /` should return
"Hexu AI bot is running."

To test the webhook locally before deploying, you can tunnel it with a tool
like `ngrok http 3000` and use the ngrok URL as your webhook Callback URL —
optional, but handy for fast iteration.

### 3. Deploy to Render

1. Push this project to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all the variables from `.env.example` under Render's Environment tab
   (use your real values, not the placeholders).
6. Deploy. Once live, your webhook URL is:
   `https://<your-render-service>.onrender.com/webhook`

### 4. Finish the Meta Webhook Setup

Back in Meta for Developers → Messenger → Settings → Webhooks:

1. Callback URL: the Render URL from step 3 above.
2. Verify Token: whatever you put in `WEBHOOK_VERIFY_TOKEN`.
3. Subscribe to: `messages`, `messaging_postbacks`.
4. Save — Meta will hit your live `/webhook` GET endpoint to confirm.

Then message the Hexu AI Page from Messenger and you should get a reply.

## Adding Features

- **New command**: create a new file in `commands/` exporting
  `{ name, description, handler }` (see `commands/ping.js` for the
  shortest example). `commands/index.js` picks it up automatically —
  nothing else to touch.
- **New API integration**: write a helper (e.g. `lib/weather.js`), call it
  from inside a command handler.
- **Quick replies / persistent menu**: extend `lib/messenger.js` with a
  `sendQuickReplies()` helper once you're ready — the Send API supports a
  `quick_replies` array alongside `message.text`.

## Contributing

Want to help maintain or build out Hexu AI? Contributions are welcome:

- Open a **pull request** with your change.
- Or reach out directly at **kisakitetta852@gmail.com** if you'd like to
  get involved as a developer/maintainer.