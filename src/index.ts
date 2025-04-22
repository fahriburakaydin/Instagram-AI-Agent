// src/index.ts

import dotenv from "dotenv";
import logger from "./config/logger";
import { shutdown } from "./services";
import { app, runAgents } from "./app";
import { initAgent } from "./Agent/index";

dotenv.config();

process.on("uncaughtException", err => {
  logger.error("🚫 Uncaught Exception:", err);
});
process.on("unhandledRejection", reason => {
  logger.error("🚫 Unhandled Rejection:", reason);
});

async function start() {
  try {
    await initAgent();
    logger.info("✅ AI agent initialized.");

    runAgents();

    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
      logger.info(`HTTP server listening on port ${port}`);
    });

    process.on("SIGINT", () => shutdown(server));
    process.on("SIGTERM", () => shutdown(server));
  } catch (err) {
    logger.error("🚫 Fatal startup error:", err);
    process.exit(1);
  }
}

start();
