"use strict";

const { ingestOffer, markProviderSuccess } = require("../db/catalog");

const PROVIDER_ID = "flipkart-affiliate-api";
const SEARCH_URL = "https://affiliate-api.flipkart.net/affiliate/1.0/search.json";

function amount(value) {
  if (value == null) return null;
  const number = Number(value.amount == null ? value : value.amount);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function imageFrom(images) {
  if (!images || typeof images !== "object") return null;
  return images["400x400"] || images["275x275"] || images["200x200"] || images.unknown || null;
}

function mapProduct(record) {
  const base = record && (record.productBaseInfoV1 || record.productBaseInfo);
  if (!base) return null;
  const attrs = base.productAttributes || base;
  const productId = base.productId || (base.productIdentifier && base.productIdentifier.productId);
  const title = base.title || attrs.title;
  const url = base.productUrl || attrs.productUrl;
  if (!productId || !title || !url) return null;

  const imageUrl = imageFrom(base.imageUrls || attrs.imageUrls);
  const price = amount(base.sellingPrice || base.flipkartSpecialPrice || base.flipkartSellingPrice ||
    attrs.sellingPrice || attrs.flipkartSpecialPrice || attrs.flipkartSellingPrice);
  const mrp = amount(base.maximumRetailPrice || attrs.maximumRetailPrice);
  const stock = base.inStock == null ? attrs.inStock : base.inStock;

  return {
    title,
    brand: base.productBrand || attrs.productBrand || null,
    retailerId: "flipkart",
    retailerSku: String(productId),
    providerId: PROVIDER_ID,
    productUrl: url,
    imageUrl,
    price,
    mrp,
    currency: "INR",
    availability: stock === true ? "in_stock" : stock === false ? "out_of_stock" : "unknown"
  };
}

async function searchAndIngest(storage, query) {
  const affiliateId = process.env.FLIPKART_AFFILIATE_ID;
  const affiliateToken = process.env.FLIPKART_AFFILIATE_TOKEN;
  if (!affiliateId || !affiliateToken) return { connected: false, ingested: 0 };

  const url = new URL(SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("resultCount", "10");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Fk-Affiliate-Id": affiliateId,
      "Fk-Affiliate-Token": affiliateToken
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error("Flipkart product API returned HTTP " + response.status);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const products = Array.isArray(payload.productInfoList) ? payload.productInfoList : [];
  let ingested = 0;
  for (const record of products) {
    const offer = mapProduct(record);
    if (!offer) continue;
    await ingestOffer(storage, offer);
    ingested += 1;
  }
  await markProviderSuccess(storage, PROVIDER_ID, "Flipkart Affiliate API");
  return { connected: true, ingested };
}

module.exports = { searchAndIngest, mapProduct, PROVIDER_ID };
