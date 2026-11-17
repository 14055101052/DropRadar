const API_URL = "https://affiliate-api.flipkart.net/affiliate/1.0/search.json";

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeHttpUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function readCategoryNames(categoryPath) {
  if (!categoryPath) return [];
  let parsed = categoryPath;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  const names = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.title === "string") names.push(value.title);
    if (typeof value.node_name === "string") names.push(value.node_name);
    Object.values(value).forEach(visit);
  };
  visit(parsed);
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function normalizeProduct(entry) {
  const base = entry?.productBaseInfoV1 || {};
  const shipping = entry?.productShippingInfoV1 || {};
  const specs = entry?.categorySpecificInfoV1?.keySpecs;
  const price = base.flipkartSpecialPrice || base.flipkartSellingPrice || base.sellingPrice || null;
  const mrp = base.maximumRetailPrice || null;
  const images = base.imageUrls || {};

  const title = String(base.title || "").trim();
  const productUrl = safeHttpUrl(base.productUrl);
  if (!title || !productUrl) return null;

  return {
    id: String(base.productId || productUrl),
    title,
    brand: String(base.productBrand || "").trim(),
    categories: readCategoryNames(base.categoryPath),
    price: numeric(price?.amount),
    currency: String(price?.currency || mrp?.currency || "INR"),
    mrp: numeric(mrp?.amount),
    discountPercentage: numeric(base.discountPercentage),
    imageUrl: safeHttpUrl(images["400x400"] || images["200x200"] || images["800x800"] || images.unknown),
    productUrl,
    inStock: typeof base.inStock === "boolean" ? base.inStock : null,
    shippingCharge: numeric(shipping.shippingCharges?.amount),
    keySpecs: Array.isArray(specs) ? specs.filter((item) => typeof item === "string").slice(0, 5) : []
  };
}

async function searchFlipkartProducts(query) {
  const affiliateId = process.env.FLIPKART_AFFILIATE_ID;
  const affiliateToken = process.env.FLIPKART_AFFILIATE_TOKEN;

  if (!affiliateId || !affiliateToken) {
    const error = new Error("Flipkart search credentials are not configured.");
    error.code = "FLIPKART_CREDENTIALS_MISSING";
    throw error;
  }

  const url = new URL(API_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("resultCount", "10");

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Fk-Affiliate-Id": affiliateId,
        "Fk-Affiliate-Token": affiliateToken,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });
  } catch (cause) {
    const error = new Error("Could not reach Flipkart product search.");
    error.code = "FLIPKART_NETWORK_ERROR";
    error.cause = cause;
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    const error = new Error("Flipkart rejected the affiliate credentials.");
    error.code = "FLIPKART_AUTH_ERROR";
    throw error;
  }
  if (response.status === 429) {
    const error = new Error("Flipkart product search rate limit was reached.");
    error.code = "FLIPKART_RATE_LIMITED";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Flipkart product search returned an unsuccessful response.");
    error.code = "FLIPKART_UPSTREAM_ERROR";
    throw error;
  }

  const payload = await response.json();
  const entries = Array.isArray(payload.productInfoList) ? payload.productInfoList : [];
  return entries.map(normalizeProduct).filter(Boolean).slice(0, 10);
}

module.exports = { searchFlipkartProducts };
