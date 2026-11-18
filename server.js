const express = require("express");
const helmet = require("helmet");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { migrateStorage } = require("./db/migrations");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);
const { ingestOffer, searchCatalog, providerStatuses, markProviderError } = require("./db/catalog");
const { searchAndIngest: searchFlipkart } = require("./providers/flipkart");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

// Without DATABASE_URL, SQLite is useful for local development only.
// Render's free web-service filesystem is temporary.
const sqlite = pool ? null : new Database(process.env.DB_PATH || path.join(__dirname, "dropradar.db"));

const STORES = [
  { id: "amazon", name: "Amazon", connected: false },
  { id: "flipkart", name: "Flipkart", connected: false },
  { id: "myntra", name: "Myntra", connected: false },
  { id: "croma", name: "Croma", connected: false },
  { id: "ajio", name: "AJIO", connected: false },
  { id: "tatacliq", name: "Tata CLiQ", connected: false }
];

const RESTRICTED_CATALOG_PATTERN = /\b(?:firearms?|guns?|ammunition|ammo|rifles?|pistols?|shotguns?|knives?|switchblades?|swords?|tasers?|pepper\s+spray|self[-\s]?defen[cs]e|cannabis|marijuana|weed|thc|cbd|cocaine|heroin|methamphetamine|ecstasy|nicotine|tobacco|cigarettes?|vapes?|vaping|e[-\s]?cigarettes?|alcohol|liquor|beer|wine|gambling|casino|sports?\s+betting|betting|pesticides?|poisons?|toxic\s+chemicals?)\b/i;

function containsRestrictedCatalogContent(value) {
  return RESTRICTED_CATALOG_PATTERN.test(String(value || ""));
}

function identifyMerchant(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const known = [
    ["amazon.in", "Amazon"], ["amazon.com", "Amazon"],
    ["flipkart.com", "Flipkart"],
    ["myntra.com", "Myntra"],
    ["croma.com", "Croma"],
    ["ajio.com", "AJIO"],
    ["tatacliq.com", "Tata CLiQ"],
    ["nike.com", "Nike"]
  ];
  const match = known.find(([domain]) => host === domain || host.endsWith("." + domain));
  return {
    url: url.toString(),
    merchant: match ? match[1] : host,
    supported: Boolean(match)
  };
}


const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const authAttempts = new Map();

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  const part = raw.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return "dr_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + secure;
}
function checkSameOrigin(req, res) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    if (new URL(origin).origin === new URL(req.protocol + "://" + req.get("host")).origin) return true;
  } catch {}
  res.status(403).json({ error: "Request origin was not accepted." });
  return false;
}
function rateLimitAuth(req, res) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > current.resetAt) { current.count = 0; current.resetAt = now + 15 * 60 * 1000; }
  current.count += 1;
  authAttempts.set(key, current);
  if (authAttempts.size > 5000) authAttempts.clear();
  if (current.count <= 12) return true;
  res.status(429).json({ error: "Too many sign-in attempts. Please wait a little and try again." });
  return false;
}
async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  if (pool) {
    await pool.query("INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)", [tokenHash,userId,expiresAt]);
  } else {
    sqlite.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(tokenHash,userId,expiresAt.toISOString());
  }
  res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
}
async function requireUser(req, res, next) {
  try {
    const token = cookieValue(req, "dr_session");
    if (!token || token.length > 200) return res.status(401).json({ error: "Sign in to use your personal watchlist.", code: "AUTH_REQUIRED" });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    let user;
    if (pool) {
      const result = await pool.query(
        "SELECT u.id::text AS id,u.email FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
        [hash]
      );
      user = result.rows[0];
    } else {
      user = sqlite.prepare(
        "SELECT u.id,u.email FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP"
      ).get(hash);
    }
    if (!user) return res.status(401).json({ error: "Your session expired. Please sign in again.", code: "AUTH_REQUIRED" });
    req.user = user;
    next();
  } catch (error) { next(error); }
}

async function initializeStorage() {
  await migrateStorage({ pool, sqlite });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (_req, res, next) => {
  try {
    if (pool) await pool.query("SELECT 1");
    else sqlite.prepare("SELECT 1").get();
    res.json({
      ok: true,
      service: "DropRadar",
      version: "0.3.0",
      storage: pool ? "hosted-postgresql" : "local-sqlite-temporary",
      productSearch: "verified-catalogue-and-configured-retailer-providers",
      affiliateLinks: false
    });
  } catch (error) { next(error); }
});


app.get("/api/auth/me", async (req, res) => {
  const token = cookieValue(req, "dr_session");
  if (!token || token.length > 200) return res.json({ user: null });
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  try {
    const result = pool
      ? await pool.query("SELECT u.id::text AS id,u.email FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()", [hash])
      : { rows: [sqlite.prepare("SELECT u.id,u.email FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP").get(hash)].filter(Boolean) };
    res.json({ user: result.rows[0] || null });
  } catch (error) { console.error("Auth lookup failed:", error.message); res.status(500).json({ error: "Could not check your sign-in." }); }
});

app.post("/api/auth/signup", async (req, res, next) => {
  if (!checkSameOrigin(req,res) || !rateLimitAuth(req,res)) return;
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Use a password between 10 and 128 characters." });
  try {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, 64);
    const passwordHash = "scrypt$" + salt.toString("hex") + "$" + Buffer.from(derived).toString("hex");
    const userId = crypto.randomUUID();
    if (pool) await pool.query("INSERT INTO app_users (id,email,password_hash) VALUES ($1,$2,$3)", [userId,email,passwordHash]);
    else sqlite.prepare("INSERT INTO app_users (id,email,password_hash) VALUES (?,?,?)").run(userId,email,passwordHash);
    await createSession(userId,res);
    res.status(201).json({ user: { id:userId,email } });
  } catch (error) {
    if (error.code === "23505" || error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "An account with this email already exists." });
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  if (!checkSameOrigin(req,res) || !rateLimitAuth(req,res)) return;
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (email.length > 254 || password.length > 128) return res.status(400).json({ error: "Check your email and password." });
  try {
    const result = pool
      ? await pool.query("SELECT id::text AS id,email,password_hash FROM app_users WHERE LOWER(email)=$1", [email])
      : { rows: [sqlite.prepare("SELECT id,email,password_hash FROM app_users WHERE email=? COLLATE NOCASE").get(email)].filter(Boolean) };
    const user = result.rows[0];
    let valid = false;
    if (user && user.password_hash.startsWith("scrypt$")) {
      const [,saltHex,hashHex] = user.password_hash.split("$");
      const expected = Buffer.from(hashHex,"hex");
      const actual = Buffer.from(await scrypt(password,Buffer.from(saltHex,"hex"),expected.length));
      valid = expected.length === actual.length && crypto.timingSafeEqual(expected,actual);
    }
    if (!valid) return res.status(401).json({ error: "Email or password is incorrect." });
    await createSession(user.id,res);
    res.json({ user: { id:user.id,email:user.email } });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", async (req, res, next) => {
  if (!checkSameOrigin(req,res)) return;
  try {
    const token = cookieValue(req,"dr_session");
    if (token && token.length <= 200) {
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      if (pool) await pool.query("DELETE FROM user_sessions WHERE token_hash=$1",[hash]);
      else sqlite.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(hash);
    }
    res.setHeader("Set-Cookie",sessionCookie("",0));
    res.json({ ok:true });
  } catch (error) { next(error); }
});

app.get("/api/stores", async (_req, res, next) => {
  try {
    const providers = await providerStatuses({ pool, sqlite });
    const flipkart = providers.find((provider) => provider.id === "flipkart-affiliate-api");
    res.json({ stores: STORES.map((store) => ({
      ...store,
      connected: store.id === "flipkart" && flipkart ? flipkart.status === "connected" : false
    })) });
  } catch (error) { next(error); }
});

app.get("/api/search", async (req, res, next) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const store = String(req.query.store || "all").trim().toLowerCase();
  if (q.length < 2) return res.status(400).json({ error: "Enter at least 2 characters." });
  if (containsRestrictedCatalogContent(q)) {
    return res.status(400).json({ code: "CATEGORY_NOT_SUPPORTED", message: "This product category isn't supported by DropRadar." });
  }
  if (store !== "all" && !STORES.some((item) => item.id === store)) {
    return res.status(400).json({ error: "Choose a store from the available filters." });
  }
  let providerSync = { connected: false, ingested: 0 };
  if (store === "all" || store === "flipkart") {
    try {
      providerSync = await searchFlipkart({ pool, sqlite }, q);
    } catch (error) {
      await markProviderError({ pool, sqlite }, "flipkart-affiliate-api", "Flipkart Affiliate API", error);
      console.warn("Flipkart provider request failed:", error.message);
      providerSync = { connected: true, ingested: 0, warning: "Flipkart could not refresh right now; showing previously stored verified listings where available." };
    }
  }
  try {
    const items = await searchCatalog({ pool, sqlite }, q, store);
    return res.json({ items, query: q, selectedStore: store, source: "verified_catalogue", providerSync });
  } catch (error) { return next(error); }
});

app.get("/api/providers", async (_req, res, next) => {
  try {
    const providers = await providerStatuses({ pool, sqlite });
    return res.json({ providers });
  } catch (error) { return next(error); }
});

// Private ingestion endpoint for a future approved retailer adapter. It remains
// disabled until PRODUCT_INGESTION_SECRET is configured on the server.
app.post("/api/internal/catalog/ingest", async (req, res, next) => {
  const expected = process.env.PRODUCT_INGESTION_SECRET || "";
  const supplied = String(req.get("x-product-ingestion-secret") || "");
  if (!expected) return res.status(503).json({ error: "Catalogue ingestion is not configured." });
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ error: "Unauthorised." });
  }
  if (containsRestrictedCatalogContent(req.body.title) || containsRestrictedCatalogContent(req.body.category)) {
    return res.status(400).json({ error: "This product category isn't supported by DropRadar." });
  }
  try {
    const result = await ingestOffer({ pool, sqlite }, req.body);
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Offer could not be ingested." });
  }
});

app.get("/api/catalog/offers/:offerId/history", async (req, res, next) => {
  const offerId = String(req.params.offerId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offerId)) {
    return res.status(404).json({ error: "Offer not found." });
  }
  try {
    if (pool) {
      const offer = await pool.query("SELECT id FROM store_offers WHERE id=$1", [offerId]);
      if (!offer.rowCount) return res.status(404).json({ error: "Offer not found." });
      const result = await pool.query(
        "SELECT price::float8 AS price,currency,availability,observed_at FROM price_observations WHERE offer_id=$1 ORDER BY observed_at DESC LIMIT 90",
        [offerId]
      );
      return res.json({ offerId, observations: result.rows.reverse() });
    }
    const offer = sqlite.prepare("SELECT id FROM store_offers WHERE id=?").get(offerId);
    if (!offer) return res.status(404).json({ error: "Offer not found." });
    const observations = sqlite.prepare(
      "SELECT price,currency,availability,observed_at FROM price_observations WHERE offer_id=? ORDER BY observed_at DESC LIMIT 90"
    ).all(offerId).reverse();
    return res.json({ offerId, observations });
  } catch (error) { return next(error); }
});

app.get("/api/watchlist", requireUser, async (req, res, next) => {
  try {
    if (pool) {
      const result = await pool.query(
        "SELECT w.id::text AS id,w.url,w.title,w.merchant,w.target_price::float8 AS target_price,w.created_at," +
        "w.catalog_product_id::text AS product_id,w.store_offer_id::text AS offer_id,o.price::float8 AS current_price,o.currency,o.availability,o.last_seen_at AS price_seen_at " +
        "FROM watchlist w LEFT JOIN store_offers o ON o.id=w.store_offer_id WHERE w.user_id=$1 ORDER BY w.id DESC"
      , [req.user.id]);
      return res.json({ items: result.rows });
    }
    const rows = sqlite.prepare(
      "SELECT w.id,w.url,w.title,w.merchant,w.target_price,w.created_at,w.catalog_product_id AS product_id," +
      "w.store_offer_id AS offer_id,o.price AS current_price,o.currency,o.availability,o.last_seen_at AS price_seen_at " +
      "FROM watchlist w LEFT JOIN store_offers o ON o.id=w.store_offer_id WHERE w.user_id=? ORDER BY w.id DESC"
    ).all(req.user.id);
    return res.json({ items: rows });
  } catch (error) { next(error); }
});

app.post("/api/watchlist", requireUser, async (req, res, next) => {
  if (!checkSameOrigin(req,res)) return;
  const title = String(req.body.title || "").trim().slice(0, 140);
  const info = identifyMerchant(String(req.body.url || "").trim());
  const rawTarget = req.body.targetPrice;
  const target = rawTarget === "" || rawTarget == null ? null : Number(rawTarget);
  const productId = String(req.body.productId || "").trim();
  const offerId = String(req.body.offerId || "").trim();
  const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if ((productId && !validUuid(productId)) || (offerId && !validUuid(offerId))) {
    return res.status(400).json({ error: "Invalid catalogue reference." });
  }
  if (Boolean(productId) !== Boolean(offerId)) {
    return res.status(400).json({ error: "Product and offer references must be supplied together." });
  }

  if (!info) return res.status(400).json({ error: "Enter a valid public http or https product URL." });
  if (!title) return res.status(400).json({ error: "Give this product a name so you can recognise it." });
  if (containsRestrictedCatalogContent(title)) {
    return res.status(400).json({ error: "This product category isn't supported by DropRadar." });
  }
  if (target !== null && (!Number.isFinite(target) || target <= 0)) {
    return res.status(400).json({ error: "Target price must be a positive number." });
  }

  try {
    let item;
    if (pool) {
      if (offerId) {
        const linked = await pool.query("SELECT 1 FROM store_offers WHERE id=$1 AND product_id=$2", [offerId, productId]);
        if (!linked.rowCount) return res.status(400).json({ error: "Catalogue listing was not found." });
      }
      const result = await pool.query(
        "INSERT INTO watchlist (url,title,merchant,target_price,catalog_product_id,store_offer_id,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
        "RETURNING id::text AS id,url,title,merchant,target_price::float8 AS target_price,created_at,catalog_product_id::text AS product_id,store_offer_id::text AS offer_id",
        [info.url,title,info.merchant,target,productId || null,offerId || null,req.user.id]
      );
      item = result.rows[0];
    } else {
      if (offerId) {
        const linked = sqlite.prepare("SELECT 1 FROM store_offers WHERE id=? AND product_id=?").get(offerId, productId);
        if (!linked) return res.status(400).json({ error: "Catalogue listing was not found." });
      }
      const result = sqlite.prepare(
        "INSERT INTO watchlist (url,title,merchant,target_price,catalog_product_id,store_offer_id,user_id) VALUES (?,?,?,?,?,?,?)"
      ).run(info.url,title,info.merchant,target,productId || null,offerId || null,req.user.id);
      item = sqlite.prepare(
        "SELECT id,url,title,merchant,target_price,created_at,catalog_product_id AS product_id,store_offer_id AS offer_id FROM watchlist WHERE id=?"
      ).get(result.lastInsertRowid);
    }
    return res.status(201).json({
      item,
      tracking: false,
      note: "Saved to your watchlist. Automatic price checks and alerts will activate after a verified retailer data source is connected."
    });
  } catch (error) {
    if (error.code === "23505" || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "This link is already in your watchlist." });
    }
    return next(error);
  }
});

app.patch("/api/watchlist/:id", requireUser, async (req, res, next) => {
  if (!checkSameOrigin(req,res)) return;
  const id = String(req.params.id);
  if (!/^\d+$/.test(id)) return res.status(404).json({ error: "Item not found." });

  const rawTarget = req.body.targetPrice;
  const target = rawTarget === "" || rawTarget == null ? null : Number(rawTarget);
  if (target !== null && (!Number.isFinite(target) || target <= 0)) {
    return res.status(400).json({ error: "Target price must be a positive number." });
  }

  try {
    let item;
    if (pool) {
      const result = await pool.query(
        "UPDATE watchlist SET target_price = $1 WHERE id = $2 AND user_id = $3 " +
        "RETURNING id::text AS id, url, title, merchant, target_price::float8 AS target_price, created_at",
        [target, id, req.user.id]
      );
      item = result.rows[0];
    } else {
      const result = sqlite.prepare("UPDATE watchlist SET target_price = ? WHERE id = ? AND user_id = ?")
        .run(target, Number(id), req.user.id);
      if (!result.changes) return res.status(404).json({ error: "Item not found." });
      item = sqlite.prepare(
        "SELECT id, url, title, merchant, target_price, created_at FROM watchlist WHERE id = ?"
      ).get(Number(id));
    }
    if (!item) return res.status(404).json({ error: "Item not found." });
    return res.json({ item });
  } catch (error) { return next(error); }
});

app.delete("/api/watchlist/:id", requireUser, async (req, res, next) => {
  if (!checkSameOrigin(req,res)) return;
  const id = String(req.params.id);
  if (!/^\d+$/.test(id)) return res.status(404).json({ error: "Item not found." });
  try {
    let deleted;
    if (pool) {
      const result = await pool.query("DELETE FROM watchlist WHERE id = $1 AND user_id = $2", [id, req.user.id]);
      deleted = result.rowCount;
    } else {
      deleted = sqlite.prepare("DELETE FROM watchlist WHERE id = ? AND user_id = ?").run(Number(id), req.user.id).changes;
    }
    if (!deleted) return res.status(404).json({ error: "Item not found." });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  await initializeStorage();
  app.listen(PORT, "0.0.0.0", () => {
    console.log("DropRadar listening on port " + PORT + " using " +
      (pool ? "hosted PostgreSQL" : "temporary local SQLite"));
  });
}

start().catch((error) => {
  console.error("DropRadar could not start:", error);
  process.exit(1);
});

async function shutdown() {
  try {
    if (pool) await pool.end();
    if (sqlite) sqlite.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
