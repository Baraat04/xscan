import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Browser } from "puppeteer-core";
import { config } from "../config.js";

// Pages that build their content with JavaScript (SAM.gov and most modern portals) arrive as an empty shell.
// For those, the page is opened in a headless Chrome and read once it has loaded. The browser is a second
// way into the network, so every request it makes, redirects and the page's own scripts included, must pass
// the same public-address check as a plain fetch. Anything else is blocked.

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

export const chromePath = CANDIDATES.find((p): p is string => Boolean(p && existsSync(p))) ?? null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 xscan/0.2";
const SKIP = new Set(["image", "media", "font", "manifest"]);

let shared: Promise<Browser> | null = null;

function browser() {
  if (!chromePath) throw new Error("No Chrome or Chromium found. Set CHROME_PATH to read pages that need JavaScript.");
  if (!shared) {
    // A profile folder of its own under the data directory, so nothing is written to the system temp drive.
    const profile = resolve(config.dataDir, "..", "chrome-profile");
    mkdirSync(profile, { recursive: true });
    // Loaded on first use, since most imports never need a browser, and through require: under tsx watch
    // the ESM build of puppeteer-core never finished loading, while the CommonJS build loads in ~2 s.
    const puppeteer: typeof import("puppeteer-core").default = createRequire(import.meta.url)("puppeteer-core");
    shared = puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      userDataDir: profile,
      args: [
        "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--disable-background-networking", "--disable-sync",
        // Chrome refuses to sandbox as root, which is how the Docker image runs.
        ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ],
    }).then((b) => {
      b.on("disconnected", () => (shared = null));
      // A restart (tsx watch) or shutdown must not leave Chrome processes behind.
      process.once("exit", () => b.process()?.kill());
      return b;
    });
    shared.catch(() => (shared = null));
  }
  return shared;
}

/**
 * Opens a page in headless Chrome and returns its HTML after scripts have run. `allow` decides, per URL,
 * whether the browser may load it; it is called for the page itself and for every request the page makes.
 */
export async function renderPage(url: string, allow: (u: URL) => Promise<boolean>, timeoutMs = 25000) {
  const b = await browser();
  const page = await b.newPage();
  const verdicts = new Map<string, Promise<boolean>>();
  const allowed = (u: URL) => {
    if (u.protocol === "data:" || u.protocol === "blob:") return Promise.resolve(true);
    if (u.protocol !== "http:" && u.protocol !== "https:") return Promise.resolve(false);
    if (!verdicts.has(u.host)) verdicts.set(u.host, allow(u).catch(() => false));
    return verdicts.get(u.host)!;
  };
  try {
    await page.setUserAgent(UA);
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      if (req.isInterceptResolutionHandled()) return;
      try {
        if (SKIP.has(req.resourceType()) || !(await allowed(new URL(req.url())))) return void (await req.abort("blockedbyclient"));
        await req.continue();
      } catch {
        // The page may have closed while the check ran; nothing left to resolve.
      }
    });
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    } catch (e) {
      // A page that keeps polling never goes idle; whatever has rendered by the deadline is still useful.
      if (!/timeout/i.test((e as Error).message)) throw e;
    }
    // Search pages often fetch their results after the network first goes quiet: wait until the text stops growing.
    let last = -1;
    for (let i = 0; i < 16; i++) {
      const size = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => last);
      if (size === last && size > 0) break;
      last = size;
      await new Promise((r) => setTimeout(r, 750));
    }
    return { url: page.url(), html: await page.content() };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Closes the shared browser, if one was started. */
export async function closeBrowser() {
  const b = await shared?.catch(() => null);
  await b?.close();
}
