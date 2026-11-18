"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeDeal } = require("../services/dealmind");

test("scores a listing using MRP and matched-store evidence", () => {
  const result = analyzeDeal({
    price: 7500,
    mrp: 10000,
    matchedStoreCount: 2,
    lowestStorePrice: 7500
  });
  assert.equal(result.state, "assessed");
  assert.equal(result.score, 81);
  assert.equal(result.confidence, "medium");
  assert.ok(result.reasons.some((reason) => reason.includes("25% below")));
  assert.ok(result.reasons.some((reason) => reason.includes("lowest price")));
});

test("uses recorded price history only after at least three observations", () => {
  const result = analyzeDeal({
    price: 9000,
    mrp: 12000,
    historicalLow: 8900,
    historicalAverage: 10500,
    observationCount: 5
  });
  assert.equal(result.state, "assessed");
  assert.equal(result.score, 88);
  assert.ok(result.signals.includes("price_history"));
});

test("does not invent a score from a single MRP signal", () => {
  const result = analyzeDeal({ price: 9000, mrp: 12000 });
  assert.equal(result.score, null);
  assert.equal(result.state, "insufficient_data");
  assert.equal(result.confidence, "low");
});

test("does not treat one or two observations as price history", () => {
  const result = analyzeDeal({
    price: 9000,
    mrp: 12000,
    historicalLow: 8500,
    historicalAverage: 10000,
    observationCount: 2
  });
  assert.equal(result.score, null);
  assert.ok(!result.signals.includes("price_history"));
  assert.ok(result.reasons.some((reason) => reason.includes("three are needed")));
});

test("requires a current verified price", () => {
  const result = analyzeDeal({ mrp: 10000, matchedStoreCount: 2, lowestStorePrice: 8000 });
  assert.equal(result.score, null);
  assert.equal(result.label, "Price unavailable");
});
