# Hexu AI — Messenger Bot

Commands + AI fallback + Supabase-backed conversation history, for the
"Hexu AI" Facebook Page.

## Project structure

```
index.js            Express server: webhook verify + message routing
lib/messenger.js     Send API wrapper (sendText, typing indicator)
lib/claude.js         Claude API wrapper for AI fallback replies
lib/supabase.js       User + message history storage
commands/index.js     Command parser + registry (add new commands here)
supabase-schema.sql   Tables to create in Supabase
.env.example           Env vars you need (copy to .env for local dev)
```

## 1. Supabase

1. Open your Supabase project (new one, or the existing Classboard project).
2. Go to SQL Editor, paste the contents of `supabase-schema.sql`, run it.
3. Grab your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
   Project Settings → API. Use the **service role** key (not the anon key)
   since this server runs with full trust, not per-user auth.

## 2. Local setup

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

## 3. Deploy to Render

1. Push this project to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all the variables from `.env.example` under Render's Environment tab
   (use your real values, not the placeholders).
6. Deploy. Once live, your webhook URL is:
   `https://<your-render-service>.onrender.com/webhook`

## 4. Finish the Meta webhook setup

Back in Meta for Developers → Messenger → Settings → Webhooks:

1. Callback URL: the Render URL from step 3 above.
2. Verify Token: whatever you put in `WEBHOOK_VERIFY_TOKEN`.
3. Subscribe to: `messages`, `messaging_postbacks`.
4. Save — Meta will hit your live `/webhook` GET endpoint to confirm.

Then message the Hexu AI Page from Messenger and you should get a reply.

## Adding features

- **New command**: add an entry to `commands` in `commands/index.js`.
- **New API integration**: write a helper (e.g. `lib/weather.js`), call it
  from inside a command handler in `commands/index.js`.
- **Quick replies / persistent menu**: extend `lib/messenger.js` with a
  `sendQuickReplies()` helper once you're ready — the Send API supports a
  `quick_replies` array alongside `message.text`.
