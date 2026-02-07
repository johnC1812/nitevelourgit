import { chromium } from "playwright";

const URL = process.env.URL || "http://127.0.0.1:8788/";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", msg => {
  const тип = msg.type();
  console.log(`[console.${тип}] ${msg.text()}`);
});

page.on("pageerror", err => {
  console.log(`[pageerror] ${String(err)}`);
});

page.on("response", async res => {
  const status = res.status();
  if (status >= 400) {
    console.log(`[http ${status}] ${res.url()}`);
  }
});

page.on("requestfailed", req => {
  console.log(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText || ""}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await browser.close();
