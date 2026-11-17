const express = require("express");
const helmet = require("helmet");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, "dropradar.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    merchant TEXT NOT NULL,
    target_price REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

function identifyMerchant(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\\./, "");
  const known = [
    ["amazon.in", "Amazon India"], ["amazon.com", "Amazon"],
    ["flipkart.com", "Flipkart"], ["myntra.com", "Myntra"],
    ["ajio.com", "AJIO"], ["nike.com", "Nike"]
  ];
  const match = known.find(([domain]) => host === domain || host.endsWith("." + domain));
  return { url: u.toString(), merchant: match ? match[1] : host, supported: !!match };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "DropRadar", version: "0.1.0" }));

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Enter at least 2 characters." });
  return res.status(503).json({
    code: "SEARCH_PROVIDER_NOT_CONFIGURED",
    message: "Product search is not connected yet. DropRadar will only show verified retailer data once a provider is configured."
  });
});

app.get("/api/watchlist", (_req, res) => {
  const rows = db.prepare("SELECT id, url, title, merchant, target_price, created_at FROM watchlist ORDER BY id DESC").all();
  res.json({ items: rows });
});

app.post("/api/watchlist", (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 140);
  const info = identifyMerchant(String(req.body.url || "").trim());
  const target = req.body.targetPrice === "" || req.body.targetPrice == null ? null : Number(req.body.targetPrice);
  if (!info) return res.status(400).json({ error: "Enter a valid http or https product URL." });
  if (!title) return res.status(400).json({ error: "Give this product a name so you can recognise it." });
  if (target !== null && (!Number.isFinite(target) || target <= 0)) return res.status(400).json({ error: "Target price must be a positive number." });
  try {
    const result = db.prepare("INSERT INTO watchlist (url, title, merchant, target_price) VALUES (?, ?, ?, ?)")
      .run(info.url, title, info.merchant, target);
    res.status(201).json({
      item: db.prepare("SELECT * FROM watchlist WHERE id = ?").get(result.lastInsertRowid),
      tracking: false,
      note: info.supported
        ? "Saved. Live price tracking for this retailer still needs an approved data integration."
        : "Saved as a link. This retailer is not yet verified for price tracking."
    });
  } catch {
    res.status(409).json({ error: "This link is already in your watchlist." });
  }
});

app.delete("/api/watchlist/:id", (req, res) => {
  const result = db.prepare("DELETE FROM watchlist WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Item not found." });
  res.status(204).end();
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`DropRadar listening on port ${PORT}`));
