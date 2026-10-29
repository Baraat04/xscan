import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { chromePath, closeBrowser, renderPage } from "../src/services/render.js";
import { assertPublic } from "../src/services/web.js";

const servers: Server[] = [];
const listen = (handler: (path: string) => string) =>
  new Promise<number>((resolve) => {
    const s = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(handler(req.url ?? "/"));
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port));
  });

after(async () => {
  for (const s of servers) s.close();
  await closeBrowser();
});

test("headless rendering runs page scripts but blocks requests to private addresses", { skip: !chromePath && "no Chrome installed" }, async () => {
  // A "secret" internal service the page will try to read, and a page that renders its content with JavaScript.
  const secretPort = await listen(() => "INTERNAL-SECRET");
  const pagePort = await listen(() => `<!doctype html><body><main id="out">loading</main><script>
    document.getElementById("out").textContent = "Rendered by script: tender text";
    fetch("http://127.0.0.1:${secretPort}/").then((r) => r.text()).then((t) => { document.body.dataset.leak = t; })
      .catch(() => { document.body.dataset.leak = "blocked"; });
  </script></body>`);

  // The test page itself is local, so it is let through explicitly; everything else gets the real public-address check.
  const allow = async (u: URL) => {
    if (u.port === String(pagePort)) return true;
    await assertPublic(u);
    return true;
  };
  const { html } = await renderPage(`http://127.0.0.1:${pagePort}/`, allow, 15000);
  assert.match(html, /Rendered by script: tender text/);
  assert.doesNotMatch(html, /INTERNAL-SECRET/);
  assert.match(html, /data-leak="blocked"/);
});
