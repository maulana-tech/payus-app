// Local webhook receiver for testing Payus's Checkout API.
//
//   node web/scripts/webhook-receiver.mjs <whsec_…> [port]
//
// Set the webhook URL in /developers to http://localhost:<port>/hook (default
// 4000). Every event is printed with VALID/INVALID after checking its
// Payus-Signature exactly as a merchant server should (HMAC-SHA256 over
// "<t>.<raw body>", timestamps older than 5 minutes rejected).
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const [secret, port = "4000"] = process.argv.slice(2);
if (!secret?.startsWith("whsec_")) {
  console.error(
    "Usage: node web/scripts/webhook-receiver.mjs <whsec_…> [port]",
  );
  process.exit(1);
}

function verify(rawBody, header) {
  const parts = Object.fromEntries(
    String(header ?? "")
      .split(",")
      .map((p) => p.split("=", 2)),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return (
    parts.v1?.length === expected.length &&
    timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))
  );
}

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const valid = verify(body, req.headers["payus-signature"]);
    let event = {};
    try {
      event = JSON.parse(body);
    } catch {}
    console.log(
      `${new Date().toLocaleTimeString()}  ${valid ? "VALID  " : "INVALID"}  ${event.type ?? "?"}`,
    );
    console.log(JSON.stringify(event, null, 2));
    // Answer 401 to unsigned/forged requests, as a real endpoint would.
    res.writeHead(valid ? 200 : 401).end(valid ? "ok" : "bad signature");
  });
}).listen(Number(port), () =>
  console.log(`Listening on http://localhost:${port}/hook`),
);
