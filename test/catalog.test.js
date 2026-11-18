"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validate } = require("../db/catalog");

const valid = {
  title: "Sony WH-1000XM5 Wireless Headphones",
  brand: "Sony",
  model: "WH-1000XM5",
  retailerId: "flipkart",
  retailerSku: "sony-xm5-black",
  providerId: "test-fixture-provider",
  productUrl: "https://www.flipkart.com/example-product/p/itm123",
  price: 24999,
  mrp: 29990,
  currency: "INR",
  availability: "in_stock"
};

test("accepts a well-formed retailer offer", () => {
  const result = validate(valid);
  assert.equal(result.retailerId, "flipkart");
  assert.equal(result.normalizedTitle, "sony wh 1000xm5 wireless headphones");
  assert.ok(result.canonicalKey.includes("wh 1000xm5"));
});

test("rejects a retailer URL hosted on an unrelated domain", () => {
  assert.throws(() => validate({ ...valid, productUrl: "https://flipkart.com.attacker.example/item" }), /domain does not match/);
});

test("rejects non-HTTPS or non-HTTP product URLs", () => {
  assert.throws(() => validate({ ...valid, productUrl: "javascript:alert(1)" }), /valid product URL/);
});

test("rejects an MRP below the current price", () => {
  assert.throws(() => validate({ ...valid, mrp: 100 }), /MRP cannot be lower/);
});

test("rejects unsupported currency and unknown retailers", () => {
  assert.throws(() => validate({ ...valid, currency: "USD" }), /Only INR/);
  assert.throws(() => validate({ ...valid, retailerId: "unknown" }), /supported retailer/);
});

test("rejects offers without a retailer SKU", () => {
  assert.throws(() => validate({ ...valid, retailerSku: "" }), /retailer SKU/);
});
