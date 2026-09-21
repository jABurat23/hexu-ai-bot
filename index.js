const express = require("express");
const config = require("./config");
const logger = require("./utils/logger");
const webhookRouter = require("./routes/webhook");

const app = express();

// Keep the raw body around so the webhook route can verify Meta's signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => res.send("Hexu AI bot is running."));
app.use("/webhook", webhookRouter);

app.listen(config.port, () => logger.info("server", `Hexu AI bot listening on port ${config.port}`));