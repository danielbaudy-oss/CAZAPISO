// Automated cookie refresh for Idealista.
// Opens idealista.com in headless Chromium, waits for DataDome challenge to
// auto-solve, then saves the resulting cookies to cookies.json.
// Run daily via cron (before the main scraper runs).

import puppeteer from "puppeteer";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUA } from "../useragents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = join(__dirname, "cookies.json");

async function refreshCookies() {
  console.log("Refreshing Idealista cookies...");

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(randomUA());
    await page.setViewport({ width: 1366, height: 768 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["es-ES", "es", "ca", "en"] });
    });

    // Visit the homepage — this triggers DataDome's JS challenge
    await page.goto("https://www.idealista.com/", {
      waitUntil: "networkidle2",
      timeout: 45000,
    });

    // Wait for the page to fully load (DataDome challenge resolves in ~2-5s)
    await new Promise((r) => setTimeout(r, 5000));

    // Check if we got past the challenge
    const title = await page.title();
    if (/captcha|datadome|blocked/i.test(title)) {
      console.log("WARNING: Still on challenge page. Cookies may not be valid.");
      console.log("Page title:", title);
    } else {
      console.log("Page loaded successfully:", title);
    }

    // Extract all cookies for .idealista.com
    const allCookies = await page.cookies("https://www.idealista.com");
    const relevant = allCookies
      .filter((c) => c.domain.includes("idealista.com"))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));

    // Check for the critical datadome cookie
    const hasDatadome = relevant.some((c) => c.name === "datadome");
    if (!hasDatadome) {
      console.log("WARNING: No datadome cookie found. Challenge may not have resolved.");
    }

    await writeFile(COOKIES_PATH, JSON.stringify(relevant, null, 2));
    console.log(`Saved ${relevant.length} cookies to ${COOKIES_PATH}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

refreshCookies().catch((e) => {
  console.error("Cookie refresh failed:", e);
  process.exit(1);
});
