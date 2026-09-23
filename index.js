const express = require("express");
const config = require("./config");
const logger = require("./utils/logger");
const webhookRouter = require("./routes/webhook");
const dashboardRouter = require("./routes/dashboard");
const { snapshot } = require("./utils/metrics");
const { startKeepAlive, stopKeepAlive } = require("./utils/keep-alive");

const app = express();

// Keep the raw body around so the webhook route can verify Meta's signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.static('public'));

app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hexu AI - Messenger Bot</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;500;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0f172a;
          --glass-bg: rgba(255, 255, 255, 0.05);
          --glass-border: rgba(255, 255, 255, 0.1);
          --accent-1: #8b5cf6;
          --accent-2: #3b82f6;
          --text-main: #f8fafc;
          --text-muted: #94a3b8;
        }
        
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'Outfit', sans-serif;
          background-color: var(--bg-color);
          background-image: 
            radial-gradient(circle at 15% 50%, rgba(139, 92, 246, 0.15), transparent 25%),
            radial-gradient(circle at 85% 30%, rgba(59, 130, 246, 0.15), transparent 25%);
          color: var(--text-main);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .container {
          background: var(--glass-bg);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid var(--glass-border);
          border-radius: 24px;
          padding: 3rem 4rem;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: float 6s ease-in-out infinite;
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .logo {
          width: 120px;
          height: 120px;
          object-fit: contain;
          margin-bottom: 1.5rem;
          filter: drop-shadow(0 0 20px rgba(139, 92, 246, 0.5));
          animation: float 4s ease-in-out infinite alternate;
        }

        h1 {
          font-size: 3.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        p {
          font-size: 1.25rem;
          color: var(--text-muted);
          font-weight: 300;
          margin-bottom: 2.5rem;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          padding: 0.5rem 1rem;
          border-radius: 9999px;
          font-weight: 500;
          font-size: 0.875rem;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          background-color: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 10px #10b981;
          animation: pulse 2s infinite;
        }

        /* Abstract shapes in the background */
        .shape {
          position: absolute;
          filter: blur(60px);
          z-index: 1;
          opacity: 0.5;
          animation: drift 20s infinite alternate linear;
        }
        
        .shape-1 {
          top: -10%;
          left: -10%;
          width: 400px;
          height: 400px;
          background: var(--accent-1);
          border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
        }

        .shape-2 {
          bottom: -20%;
          right: -10%;
          width: 500px;
          height: 500px;
          background: var(--accent-2);
          border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
          animation-delay: -5s;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        @keyframes drift {
          0% { transform: rotate(0deg) translate(0, 0); }
          100% { transform: rotate(360deg) translate(50px, 50px); }
        }
      </style>
    </head>
    <body>
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      
      <div class="container">
        <h1>Hexu AI</h1>
        <p>Intelligent Messenger Bot Service</p>
        <div class="status-badge">
          <div class="status-dot"></div>
          System Online & Active
        </div>
      </div>
    </body>
    </html>
  `);
});
app.use("/webhook", webhookRouter);
app.use("/dashboard", dashboardRouter);

const server = app.listen(config.port, () => {
  logger.info("server", `Hexu AI bot listening on port ${config.port}`);
  startKeepAlive();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server", `Received ${signal}; stopping new work.`);
  stopKeepAlive();
  webhookRouter.messageQueue.stopAccepting();
  await new Promise((resolve) => server.close(resolve));
  await webhookRouter.messageQueue.drain(config.shutdownTimeoutMs);
  logger.info("server", `Shutdown complete. Events handled: ${snapshot().eventsCompleted}`);
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));