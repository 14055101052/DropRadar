"use strict";
const crypto = require("crypto");
const STORES = new Set(["amazon","flipkart","myntra","croma","ajio","tatacliq"]);
const STOCK = new Set(["in_stock","out_of_stock","unknown"]);
function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function validate(input) {
  if (!input || typeof input !== "object") throw new Error("Offer must be an object.");
  const x = {
    id: crypto.randomUUID(), productId: crypto.randomUUID(),
    title: String(input.title || "").trim().slice(0,240),
    brand: String(input.brand || "").trim().slice(0,100) || null,
    model: String(input.model || "").trim().slice(0,100) || null,
    category: String(input.category || "").trim().slice(0,80) || null,
    retailerId: String(input.retailerId || "").toLowerCase(),
    retailerSku: String(input.retailerSku || "").trim().slice(0,160),
    providerId: String(input.providerId || "").trim().slice(0,80),
    productUrl: String(input.productUrl || "").trim(),
    imageUrl: input.imageUrl ? String(input.imageUrl).trim() : null,
    price: input.price == null ? null : Number(input.price),
    mrp: input.mrp == null ? null : Number(input.mrp),
    currency: String(input.currency || "INR").toUpperCase(),
    availability: String(input.availability || "unknown")
  };
  if (!x.title || !x.retailerSku || !x.providerId || !STORES.has(x.retailerId)) throw new Error("Title, retailer SKU, provider ID and supported retailer are required.");
  let url;
  try { url = new URL(x.productUrl); } catch { throw new Error("A valid product URL is required."); }
  if (!["http:","https:"].includes(url.protocol)) throw new Error("Product URL must use HTTP or HTTPS.");
  if (x.imageUrl && !/^https?:\/\//i.test(x.imageUrl)) throw new Error("Image URL must use HTTP or HTTPS.");
  const domains = {amazon:"amazon.in",flipkart:"flipkart.com",myntra:"myntra.com",croma:"croma.com",ajio:"ajio.com",tatacliq:"tatacliq.com"};
  const host = url.hostname.toLowerCase().replace(/^www\./,"");
  if (!(host === domains[x.retailerId] || host.endsWith("." + domains[x.retailerId]))) throw new Error("Product URL domain does not match retailer.");
  if (x.currency !== "INR") throw new Error("Only INR offers are supported.");
  if (x.price !== null && (!Number.isFinite(x.price) || x.price <= 0 || x.price > 1e8)) throw new Error("Invalid price.");
  if (x.mrp !== null && (!Number.isFinite(x.mrp) || x.mrp <= 0 || x.mrp > 1e8)) throw new Error("Invalid MRP.");
  if (x.price !== null && x.mrp !== null && x.mrp < x.price) throw new Error("MRP cannot be lower than price.");
  if (!STOCK.has(x.availability)) throw new Error("Invalid availability.");
  x.normalizedTitle = normalize(x.title);
  // Exact model matching only; otherwise exact normalized title + brand.
  x.canonicalKey = [normalize(x.brand),normalize(x.model),x.normalizedTitle].filter(Boolean).join("|");
  if (!x.canonicalKey) throw new Error("Product needs a usable title or brand.");
  x.productUrl = url.toString();
  return x;
}
async function ingestOffer(storage,input) {
  const x = validate(input);
  if (storage.pool) {
    const c = await storage.pool.connect();
    try {
      await c.query("BEGIN");
      const p = await c.query("INSERT INTO catalog_products (id,canonical_key,title,normalized_title,brand,model,category) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(canonical_key) DO UPDATE SET updated_at=NOW() RETURNING id",
        [x.productId,x.canonicalKey,x.title,x.normalizedTitle,x.brand,x.model,x.category]);
      const pid = p.rows[0].id;
      const old = await c.query("SELECT id,price::float8 AS price,availability FROM store_offers WHERE retailer_id=$1 AND retailer_sku=$2 FOR UPDATE",[x.retailerId,x.retailerSku]);
      const oid = old.rowCount ? old.rows[0].id : x.id;
      if (old.rowCount) {
        await c.query("UPDATE store_offers SET product_id=$1,title=$2,product_url=$3,image_url=$4,currency=$5,price=$6,mrp=$7,availability=$8,provider_id=$9,source_updated_at=NOW(),last_seen_at=NOW(),updated_at=NOW() WHERE id=$10",
          [pid,x.title,x.productUrl,x.imageUrl,x.currency,x.price,x.mrp,x.availability,x.providerId,oid]);
      } else {
        await c.query("INSERT INTO store_offers (id,product_id,retailer_id,retailer_sku,title,product_url,image_url,currency,price,mrp,availability,provider_id,source_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())",
          [oid,pid,x.retailerId,x.retailerSku,x.title,x.productUrl,x.imageUrl,x.currency,x.price,x.mrp,x.availability,x.providerId]);
      }
      const changed = !old.rowCount || Number(old.rows[0].price)!==Number(x.price) || old.rows[0].availability!==x.availability;
      if (x.price !== null && changed) await c.query("INSERT INTO price_observations (offer_id,price,currency,availability) VALUES ($1,$2,$3,$4)",[oid,x.price,x.currency,x.availability]);
      await c.query("INSERT INTO provider_status (provider_id,display_name,status,last_success_at,last_error) VALUES ($1,$1,'connected',NOW(),NULL) ON CONFLICT(provider_id) DO UPDATE SET status='connected',last_success_at=NOW(),last_error=NULL,updated_at=NOW()",[x.providerId]);
      await c.query("COMMIT");
      return {productId:pid,offerId:oid,priceObservationAdded:x.price!==null&&changed};
    } catch(e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  const tx = storage.sqlite.transaction(() => {
    const db=storage.sqlite;
    db.prepare("INSERT INTO catalog_products (id,canonical_key,title,normalized_title,brand,model,category) VALUES (?,?,?,?,?,?,?) ON CONFLICT(canonical_key) DO UPDATE SET updated_at=CURRENT_TIMESTAMP")
      .run(x.productId,x.canonicalKey,x.title,x.normalizedTitle,x.brand,x.model,x.category);
    const p=db.prepare("SELECT id FROM catalog_products WHERE canonical_key=?").get(x.canonicalKey);
    const old=db.prepare("SELECT id,price,availability FROM store_offers WHERE retailer_id=? AND retailer_sku=?").get(x.retailerId,x.retailerSku);
    const oid=old?old.id:x.id;
    if(old) db.prepare("UPDATE store_offers SET product_id=?,title=?,product_url=?,image_url=?,currency=?,price=?,mrp=?,availability=?,provider_id=?,source_updated_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(p.id,x.title,x.productUrl,x.imageUrl,x.currency,x.price,x.mrp,x.availability,x.providerId,oid);
    else db.prepare("INSERT INTO store_offers (id,product_id,retailer_id,retailer_sku,title,product_url,image_url,currency,price,mrp,availability,provider_id,source_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .run(oid,p.id,x.retailerId,x.retailerSku,x.title,x.productUrl,x.imageUrl,x.currency,x.price,x.mrp,x.availability,x.providerId);
    const changed=!old||Number(old.price)!==Number(x.price)||old.availability!==x.availability;
    if(x.price!==null&&changed) db.prepare("INSERT INTO price_observations (offer_id,price,currency,availability) VALUES (?,?,?,?)").run(oid,x.price,x.currency,x.availability);
    db.prepare("INSERT INTO provider_status (provider_id,display_name,status,last_success_at,last_error) VALUES (?,?,'connected',CURRENT_TIMESTAMP,NULL) ON CONFLICT(provider_id) DO UPDATE SET status='connected',last_success_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP").run(x.providerId,x.providerId);
    return {productId:p.id,offerId:oid,priceObservationAdded:x.price!==null&&changed};
  });
  return tx();
}
async function searchCatalog(storage,q,store) {
  const n="%"+normalize(q)+"%";
  if(storage.pool) {
    const args=[n]; let filter="";
    if(store!=="all"){args.push(store);filter=" AND o.retailer_id=$2";}
    const result=await storage.pool.query("SELECT p.id AS \"productId\",p.title,p.brand,p.model,o.id AS \"offerId\",o.retailer_id AS \"storeId\",o.retailer_id AS merchant,o.product_url AS \"productUrl\",o.image_url AS \"imageUrl\",o.price::float8 AS price,o.mrp::float8 AS mrp,o.currency,o.availability,o.last_seen_at AS \"lastSeenAt\",CASE WHEN o.availability='in_stock' THEN TRUE WHEN o.availability='out_of_stock' THEN FALSE ELSE NULL END AS \"inStock\" FROM catalog_products p JOIN store_offers o ON o.product_id=p.id WHERE (p.normalized_title LIKE $1 OR LOWER(COALESCE(p.brand,'')) LIKE $1 OR LOWER(o.title) LIKE $1)"+filter+" ORDER BY CASE WHEN o.price IS NULL THEN 1 ELSE 0 END,o.price ASC,o.last_seen_at DESC LIMIT 50",args);
    return result.rows.map(addDiscount);
  }
  const args=[n,n,n]; let filter="";
  if(store!=="all"){args.push(store);filter=" AND o.retailer_id=?";}
  const rows=storage.sqlite.prepare("SELECT p.id AS productId,p.title,p.brand,p.model,o.id AS offerId,o.retailer_id AS storeId,o.retailer_id AS merchant,o.product_url AS productUrl,o.image_url AS imageUrl,o.price,o.mrp,o.currency,o.availability,o.last_seen_at AS \"lastSeenAt\",CASE WHEN o.availability='in_stock' THEN 1 WHEN o.availability='out_of_stock' THEN 0 ELSE NULL END AS inStock FROM catalog_products p JOIN store_offers o ON o.product_id=p.id WHERE (p.normalized_title LIKE ? OR LOWER(COALESCE(p.brand,'')) LIKE ? OR LOWER(o.title) LIKE ?)"+filter+" ORDER BY CASE WHEN o.price IS NULL THEN 1 ELSE 0 END,o.price ASC,o.last_seen_at DESC LIMIT 50").all(...args);
  return rows.map(r=>addDiscount({...r,inStock:r.inStock===null?null:Boolean(r.inStock)}));
}
function addDiscount(row){const names={amazon:"Amazon",flipkart:"Flipkart",myntra:"Myntra",croma:"Croma",ajio:"AJIO",tatacliq:"Tata CLiQ"};return {...row,merchant:names[row.merchant]||row.merchant,discountPercentage:row.mrp&&row.price&&row.mrp>row.price?Math.round((row.mrp-row.price)/row.mrp*100):null};}
async function markProviderSuccess(storage, providerId, displayName) {
  if (storage.pool) {
    await storage.pool.query(
      "INSERT INTO provider_status (provider_id,display_name,status,last_success_at,last_error) VALUES ($1,$2,'connected',NOW(),NULL) " +
      "ON CONFLICT(provider_id) DO UPDATE SET status='connected',last_success_at=NOW(),last_error=NULL,updated_at=NOW()",
      [providerId,displayName]
    );
    return;
  }
  storage.sqlite.prepare(
    "INSERT INTO provider_status (provider_id,display_name,status,last_success_at,last_error) VALUES (?,?,'connected',CURRENT_TIMESTAMP,NULL) " +
    "ON CONFLICT(provider_id) DO UPDATE SET status='connected',last_success_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP"
  ).run(providerId,displayName);
}
async function markProviderError(storage, providerId, displayName, error) {
  const message = String(error && error.message ? error.message : "Provider request failed").slice(0, 300);
  if (storage.pool) {
    await storage.pool.query(
      "INSERT INTO provider_status (provider_id,display_name,status,last_error) VALUES ($1,$2,'degraded',$3) " +
      "ON CONFLICT(provider_id) DO UPDATE SET status='degraded',last_error=EXCLUDED.last_error,updated_at=NOW()",
      [providerId,displayName,message]
    );
    return;
  }
  storage.sqlite.prepare(
    "INSERT INTO provider_status (provider_id,display_name,status,last_error) VALUES (?,?,'degraded',?) " +
    "ON CONFLICT(provider_id) DO UPDATE SET status='degraded',last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP"
  ).run(providerId,displayName,message);
}
async function providerStatuses(storage) {
  const rows = storage.pool
    ? (await storage.pool.query("SELECT provider_id AS id,display_name AS name,status,last_success_at,last_error FROM provider_status ORDER BY display_name")).rows
    : storage.sqlite.prepare("SELECT provider_id AS id,display_name AS name,status,last_success_at,last_error FROM provider_status ORDER BY display_name").all();
  if (!rows.some((provider) => provider.id === "flipkart-affiliate-api")) {
    rows.push({ id: "flipkart-affiliate-api", name: "Flipkart Affiliate API", status: "not_connected", last_success_at: null, last_error: null });
  }
  return rows;
}
module.exports={ingestOffer,searchCatalog,providerStatuses,markProviderSuccess,markProviderError,validate};
