"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrateStorage } = require("../db/migrations");
const { ingestOffer, searchCatalog, providerStatuses } = require("../db/catalog");

test("SQLite migrations, catalogue upsert, search and price history work together", async () => {
  const sqlite = new Database(":memory:");
  try {
    await migrateStorage({ pool: null, sqlite });
    const storage = { pool: null, sqlite };
    const first = await ingestOffer(storage, {
      title: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      model: "WH-1000XM5",
      retailerId: "flipkart",
      retailerSku: "sony-xm5-black",
      providerId: "test-flipkart",
      productUrl: "https://www.flipkart.com/sony-xm5/p/itm123",
      price: 24999,
      mrp: 29990,
      currency: "INR",
      availability: "in_stock"
    });
    assert.equal(first.priceObservationAdded, true);

    const results = await searchCatalog(storage, "Sony WH-1000XM5", "all");
    assert.equal(results.length, 1);
    assert.equal(results[0].price, 24999);
    assert.equal(results[0].merchant, "Flipkart");

    const second = await ingestOffer(storage, {
      title: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      model: "WH-1000XM5",
      retailerId: "flipkart",
      retailerSku: "sony-xm5-black",
      providerId: "test-flipkart",
      productUrl: "https://www.flipkart.com/sony-xm5/p/itm123",
      price: 23999,
      mrp: 29990,
      currency: "INR",
      availability: "in_stock"
    });
    assert.equal(second.offerId, first.offerId);
    assert.equal(second.productId, first.productId);
    assert.equal(second.priceObservationAdded, true);

    const observations = sqlite.prepare(
      "SELECT price FROM price_observations WHERE offer_id=? ORDER BY id"
    ).all(first.offerId);
    assert.deepEqual(observations.map((row) => row.price), [24999, 23999]);
    const otherStore = await ingestOffer(storage, {
      title: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      model: "WH-1000XM5",
      retailerId: "amazon",
      retailerSku: "B0TESTXM5",
      providerId: "test-amazon",
      productUrl: "https://www.amazon.in/dp/B0TESTXM5",
      price: 22999,
      mrp: 29990,
      currency: "INR",
      availability: "in_stock"
    });
    assert.equal(otherStore.productId, first.productId, "same exact brand/model/title must share one canonical product");
    assert.notEqual(otherStore.offerId, first.offerId, "each retailer offer must remain independent");
    const crossStoreResults = await searchCatalog(storage, "Sony WH-1000XM5", "all");
    assert.equal(crossStoreResults.length, 2);
    assert.equal(new Set(crossStoreResults.map((row) => row.productId)).size, 1);
    assert.deepEqual(new Set(crossStoreResults.map((row) => row.merchant)), new Set(["Flipkart", "Amazon"]));
    assert.ok(crossStoreResults.every((row) => row.lastSeenAt), "comparison must show when each feed last updated");

    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    sqlite.prepare("INSERT INTO app_users (id,email,password_hash) VALUES (?,?,?)").run(userA,"a@example.test","hash");
    sqlite.prepare("INSERT INTO app_users (id,email,password_hash) VALUES (?,?,?)").run(userB,"b@example.test","hash");
    const sameUrl = "https://www.flipkart.com/shared-product/p/itm999";
    sqlite.prepare("INSERT INTO watchlist (url,title,merchant,user_id) VALUES (?,?,?,?)").run(sameUrl,"Shared product","Flipkart",userA);
    sqlite.prepare("INSERT INTO watchlist (url,title,merchant,user_id) VALUES (?,?,?,?)").run(sameUrl,"Shared product","Flipkart",userB);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE url=?").get(sameUrl).count,2);

    const statuses = await providerStatuses(storage);
    assert.equal(statuses.find((row) => row.id === "flipkart-affiliate-api").status, "not_connected");
  } finally {
    sqlite.close();
  }
});
