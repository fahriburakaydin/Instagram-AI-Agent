// src/utils/index.ts
import { promises as fs } from "fs";
import path from "path";

import logger, { setupErrorHandlers } from "../config/logger";
import { shutdown } from "../services";
import { app, runAgents } from "../app";
import { initAgent } from "../Agent/index";
import { geminiApiKeys } from "../secret";


// ————— Cookie helpers —————

/** Returns true if a valid sessionid or csrftoken cookie exists and hasn't expired. */
export async function Instagram_cookiesExist(): Promise<boolean> {
  const cookiesPath = "./cookies/Instagramcookies.json";
  try {
    await fs.access(cookiesPath);
    const data = await fs.readFile(cookiesPath, "utf-8");
    const cookies = JSON.parse(data) as any[];
    const now = Math.floor(Date.now() / 1000);
    return cookies.some(c =>
      (c.name === "sessionid" || c.name === "csrftoken") && c.expires > now
    );
  } catch (err: any) {
    if (err.code === "ENOENT") {
      logger.warn("🍪 Cookies file not found.");
      return false;
    }
    logger.error("🚫 Error checking cookies:", err);
    return false;
  }
}

/** Save cookies to disk. */
export async function saveCookies(
  cookiesPath: string,
  cookies: any[]
): Promise<void> {
  await fs.mkdir(path.dirname(cookiesPath), { recursive: true });
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  logger.info("🍪 Cookies saved.");
}

/** Load cookies from disk (or return empty array on error). */
export async function loadCookies(cookiesPath: string): Promise<any[]> {
  try {
    await fs.access(cookiesPath);
    const data = await fs.readFile(cookiesPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    logger.error("🚫 Error loading cookies:", err);
    return [];
  }
}

// ————— AI key rotation & error‐handling —————

/** Rotate to the next Gemini API key. */
export const getNextApiKey = (currentIndex: number): string => {
  return geminiApiKeys[(currentIndex + 1) % geminiApiKeys.length];
};

/**
 * Handle common AI errors (rate limits, 503s), rotating keys or retrying as needed.
 */
export async function handleError(
  error: unknown,
  currentApiKeyIndex: number,
  schema: any,
  prompt: string,
  runAgent: (s: any, p: string) => Promise<any>
): Promise<any> {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("429")) {
      logger.error(
        `🔑 API key #${currentApiKeyIndex + 1} rate‑limited, rotating key…`
      );
      return runAgent(schema, prompt);
    }
    if (msg.includes("503")) {
      logger.error("🌐 Service unavailable; retrying in 5s…");
      await new Promise(r => setTimeout(r, 5000));
      return runAgent(schema, prompt);
    }
    logger.error("🚫 AI error:", msg);
    throw error;
  }
  throw error;
}

// ————— Simple flow‑error handler —————

/**
 * Log an error in `context` without crashing the whole loop.
 */
export function setup_HandleError(error: unknown, context: string): void {
  if (error instanceof Error) {
    logger.error(`Error in ${context}:`, error.stack || error.message);
  } else {
    logger.error(`Unknown error in ${context}:`, error);
  }
}

// ————— Tweet data helpers (if used elsewhere) —————
export const saveTweetData = async (
  tweetContent: string,
  imageUrl: string,
  timeTweeted: string
): Promise<void> => {
  const tweetDataPath = path.join(__dirname, "../data/tweetData.json");
  const entry = { tweetContent, imageUrl, timeTweeted };
  try {
    await fs.access(tweetDataPath);
    const arr = JSON.parse(await fs.readFile(tweetDataPath, "utf-8"));
    arr.push(entry);
    await fs.writeFile(tweetDataPath, JSON.stringify(arr, null, 2));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(tweetDataPath), { recursive: true });
      await fs.writeFile(tweetDataPath, JSON.stringify([entry], null, 2));
    } else {
      logger.error("🚫 Error saving tweet data:", err);
      throw err;
    }
  }
};

export const canSendTweet = async (): Promise<boolean> => {
  const tweetDataPath = path.join(__dirname, "../data/tweetData.json");
  try {
    await fs.access(tweetDataPath);
    const arr = JSON.parse(await fs.readFile(tweetDataPath, "utf-8"));
    return arr.length < 17;
  } catch (err: any) {
    if (err.code === "ENOENT") return true;
    logger.error("🚫 Error checking tweet data:", err);
    throw err;
  }
};

// ————— Scraping data helper —————

export const saveScrapedData = async (
  link: string,
  content: string
): Promise<void> => {
  const scrapedPath = path.join(__dirname, "../data/scrapedData.json");
  const entry = { link, content };
  try {
    await fs.access(scrapedPath);
    const arr = JSON.parse(await fs.readFile(scrapedPath, "utf-8"));
    arr.push(entry);
    await fs.writeFile(scrapedPath, JSON.stringify(arr, null, 2));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(scrapedPath), { recursive: true });
      await fs.writeFile(scrapedPath, JSON.stringify([entry], null, 2));
    } else {
      logger.error("🚫 Error saving scraped data:", err);
      throw err;
    }
  }
};

export {
    setupErrorHandlers,
    logger,
    shutdown,
    app,
    runAgents,
    initAgent,
    /* plus any helpers you need (Instagram_cookiesExist, canSendTweet, saveScrapedData, etc.) */
  };