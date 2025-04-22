// src/client/Instagram.ts

import type { Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import UserAgent from "user-agents";
import { Server } from "proxy-chain";

import { IGusername, IGpassword } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";
import { RepliedComment, RepliedDM } from "../config/db";

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const cookiesPath = "./cookies/Instagramcookies.json";

/**
 * Ensures the page is logged in, loading or saving cookies as needed.
 */
async function ensureLogin(page: Page) {
  logger.info("▶️  ensureLogin() – checking saved cookies");
  const hasCookies = await Instagram_cookiesExist();
  logger.info(`   – cookies exist? ${hasCookies}`);
  if (hasCookies) {
    const cookies = await loadCookies(cookiesPath);
    logger.info(`   – loaded ${cookies.length} cookies, setting on page`);
    await page.setCookie(...cookies);
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    if (!(await page.$(`a[href='/${IGusername}/']`))) {
      logger.warn("   – session expired, re-logging in");
      await loginWithCredentials(page);
    } else {
      logger.info("   – session valid, logged in via cookies");
    }
  } else {
    logger.info("   – no cookies found, performing credentials login");
    await loginWithCredentials(page);
  }
}

/**
 * Performs the login flow and saves cookies.
 */
async function loginWithCredentials(page: Page) {
  logger.info("  ✏️  loginWithCredentials() – navigating to login page");
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle2" });

  logger.info("   – dismissing cookie banner if present");
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach(btn => {
      if (btn.innerText.toLowerCase().includes("allow all cookies")) {
        (btn as HTMLButtonElement).click();
      }
    });
  });

  logger.info("   – waiting for username field");
  await page.waitForSelector('input[name="username"]', { visible: true });
  logger.info("   – typing credentials");
  await page.type('input[name="username"]', IGusername, { delay: 50 });
  await page.type('input[name="password"]', IGpassword, { delay: 50 });

  logger.info("   – submitting form and waiting for navigation");
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
  ]);

  await page.waitForFunction(
    () => !window.location.href.includes("/accounts/login"),
    { timeout: 60000 }
  );
  logger.info("  ✅ Logged in successfully with credentials");

  const newCookies = await page.cookies();
  logger.info(`   – saving ${newCookies.length} cookies`);
  await saveCookies(cookiesPath, newCookies);
}

/**
 * Run exactly one feed‐interaction pass: like posts then close.
 */
export async function runInstagram() {
  logger.info("▶️  runInstagram() – single feed pass");

  // 1) Start proxy
  const server = new Server({ port: 8000 });
  await server.listen();
  logger.info("  – proxy server started on port 8000");

  // 2) Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    args: [`--proxy-server=http://localhost:8000`],
  });
  logger.info("  – Puppeteer launched");

  const page = await browser.newPage();
  await page.setUserAgent(new UserAgent().toString());

  // 3) Login / cookies
  await ensureLogin(page);

  // 4) One iteration of feed interaction
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
  await interactWithPosts(page);

  // 5) Teardown
  await browser.close();
  await server.close(true);
  logger.info("  – runInstagram() complete, browser & proxy closed");
}

/**
 * Click “Like” on up to 50 posts via in‑page dispatch.
 */
async function interactWithPosts(page: Page) {
  let idx = 1;
  const max = 50;
  while (idx <= max) {
    const clicked = await page.evaluate((n: number) => {
      const sel = `article:nth-of-type(${n}) svg[aria-label="Like"]`;
      const btn = document.querySelector<SVGElement>(sel);
      if (btn) {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }, idx);

    logger.info(clicked
      ? `  – Liked post #${idx}`
      : `  – No Like button at post #${idx}`);

    idx++;
    await delay(5000 + Math.random() * 5000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  }
}

/**
 * Scan your recent posts, find new comments, and reply.
 */
export async function runCommentReplies() {
  logger.info("▶️  runCommentReplies() – scanning for new comment replies");

  const server = new Server({ port: 8001 });
  await server.listen();
  logger.info("  – proxy server for comments started");

  const browser = await puppeteer.launch({
    headless: false,
    args: [`--proxy-server=http://localhost:8001`],
  });
  const page = await browser.newPage();
  await page.setUserAgent(new UserAgent().toString());

  await ensureLogin(page);

  await page.goto(`https://www.instagram.com/${IGusername}/`, { waitUntil: "networkidle2" });
  const postLinks = await page.$$eval("article a", els =>
    els.slice(0, 3).map(a => (a as HTMLAnchorElement).href)
  );

  for (const url of postLinks) {
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("li[data-testid='comment']", { timeout: 10000 }).catch(() => null);

    const comments = await page.$$eval("li[data-testid='comment']", lis =>
      lis.map(li => ({
        id: li.getAttribute("id") || "",
        user: li.querySelector("h3 a")?.textContent?.trim() || "",
        text: li.querySelector("span")?.textContent?.trim() || "",
      })).filter(c => c.id && c.user !== IGusername)
    );

    for (const c of comments) {
      if (await RepliedComment.findOne({ commentId: c.id })) continue;

      const schema = getInstagramCommentSchema();
      const prompt = `Reply kindly to this comment: "${c.text}"`;
      const [replyObj] = await runAgent(schema, prompt);
      const replyText = `@${c.user} ${replyObj.comment}`;

      // click the reply button
      await page.evaluate((id: string) => {
        const btn = document.querySelector(`#${id} button`);
        if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }, c.id);

      await page.waitForSelector("textarea", { visible: true });
      await page.type("textarea", replyText, { delay: 50 });
      await page.click("button[type='submit']");

      await RepliedComment.create({ commentId: c.id });
      logger.info(`💬 Replied to comment ${c.id}`);
      await delay(5000);
    }
  }

  await browser.close();
  await server.close(true);
}

/**
 * Scan your DM inbox and reply to new messages.
 */
export async function runDMReplies() {
  logger.info("▶️  runDMReplies() – scanning for new DMs");

  const server = new Server({ port: 8002 });
  await server.listen();
  logger.info("  – proxy server for DMs started");

  const browser = await puppeteer.launch({
    headless: false,
    args: [`--proxy-server=http://localhost:8002`],
  });
  const page = await browser.newPage();
  await page.setUserAgent(new UserAgent().toString());

  await ensureLogin(page);

  await page.goto("https://www.instagram.com/direct/inbox/", { waitUntil: "networkidle2" });
  await page.waitForSelector("div[role='dialog'] a", { timeout: 10000 });

  const threads = await page.$$eval("div[role='dialog'] a", els =>
    els.map(a => (a as HTMLAnchorElement).href)
  );

  for (const threadUrl of threads.slice(0, 5)) {
    await page.goto(threadUrl, { waitUntil: "networkidle2" });
    const messages = await page.$$eval("[role='listitem']", lis =>
      lis.map(li => ({
        id: li.getAttribute("data-testid") || "",
        text: li.querySelector("div[role='button'] span")?.textContent?.trim() || "",
        fromMe: Boolean(li.querySelector("svg[aria-label='Seen']")),
      }))
    );

    for (const m of messages) {
      if (m.fromMe || await RepliedDM.findOne({ messageId: m.id })) continue;

      const schema = getInstagramCommentSchema();
      const prompt = `Reply helpfully to the DM: "${m.text}"`;
      const [replyObj] = await runAgent(schema, prompt);
      const answer = replyObj.comment;

      await page.click("textarea");
      await page.type("textarea", answer, { delay: 50 });
      await page.keyboard.press("Enter");

      await RepliedDM.create({ messageId: m.id });
      logger.info(`✉️ Replied to DM ${m.id}`);
      await delay(5000);
    }
  }

  await browser.close();
  await server.close(true);
}
