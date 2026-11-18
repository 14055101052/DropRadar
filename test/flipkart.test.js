"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapProduct, PROVIDER_ID } = require("../providers/flipkart");

test("maps an official Flipkart v1 product response into the catalogue format", () => {
  const offer = mapProduct({
    productBaseInfoV1: {
      productId: "MOBTEST123",
      title: "Example Phone 128 GB",
      productBrand: "Example",
      productUrl: "https://www.flipkart.com/example-phone/p/itm123",
      imageUrls: { "400x400": "https://rukminim2.flixcart.com/example.jpg" },
      sellingPrice: { amount: 19999, currency: "INR" },
      maximumRetailPrice: { amount: 24999, currency: "INR" },
      inStock: true
    }
  });
  assert.equal(offer.retailerId, "flipkart");
  assert.equal(offer.retailerSku, "MOBTEST123");
  assert.equal(offer.providerId, PROVIDER_ID);
  assert.equal(offer.price, 19999);
  assert.equal(offer.mrp, 24999);
  assert.equal(offer.availability, "in_stock");
});

test("maps older nested product responses", () => {
  const offer = mapProduct({
    productBaseInfo: {
      productIdentifier: { productId: "OLD123" },
      productAttributes: {
        title: "Example Headphones",
        productBrand: "Example",
        productUrl: "https://www.flipkart.com/example-headphones/p/itm456",
        sellingPrice: { amount: 4999 },
        maximumRetailPrice: { amount: 6999 },
        inStock: false
      }
    }
  });
  assert.equal(offer.retailerSku, "OLD123");
  assert.equal(offer.availability, "out_of_stock");
});

test("ignores incomplete provider records rather than inventing fields", () => {
  assert.equal(mapProduct({ productBaseInfoV1: { title: "Missing URL and SKU" } }), null);
});
