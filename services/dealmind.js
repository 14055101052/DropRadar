"use strict";

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * DealMind is an evidence-based rules engine. It never invents a price or
 * predicts a future drop; it scores only signals present in retailer data.
 */
function analyzeDeal(item) {
  const price = positive(item.price);
  if (!price) {
    return {
      score: null,
      label: "Price unavailable",
      confidence: "none",
      state: "insufficient_data",
      reasons: ["A verified current price is required before a deal can be assessed."],
      signals: []
    };
  }

  let weightedPoints = 0;
  let availableWeight = 0;
  const signals = [];
  const reasons = [];

  const mrp = positive(item.mrp);
  if (mrp) {
    availableWeight += 25;
    const discount = clamp(((mrp - price) / mrp) * 100, 0, 100);
    const points = discount > 0 ? Math.min(25, (discount / 40) * 25) : 0;
    weightedPoints += points;
    signals.push("listed_mrp");
    reasons.push(discount > 0
      ? Math.round(discount) + "% below the retailer-feed MRP"
      : "No discount counted against the retailer-feed MRP");
  }

  const observationCount = Math.max(0, Number(item.observationCount) || 0);
  const historicalLow = positive(item.historicalLow);
  const historicalAverage = positive(item.historicalAverage);
  if (observationCount >= 3 && historicalLow && historicalAverage) {
    availableWeight += 50;
    let points = 0;
    if (price <= historicalLow * 1.02) {
      points = 50;
      reasons.push("At or within 2% of its recorded low (" + Math.round(historicalLow) + ")");
    } else if (price <= historicalAverage && historicalAverage > historicalLow) {
      points = 25 + 25 * ((historicalAverage - price) / (historicalAverage - historicalLow));
      reasons.push("Below its recorded average of " + Math.round(historicalAverage));
    } else {
      points = clamp(25 * (1 - ((price / historicalAverage) - 1) / 0.2), 0, 25);
      reasons.push("Above its recorded average of " + Math.round(historicalAverage));
    }
    weightedPoints += points;
    signals.push("price_history");
  } else if (observationCount > 0) {
    reasons.push("Only " + observationCount + " recorded price update" + (observationCount === 1 ? "" : "s") + "; three are needed for a history signal");
  }

  const matchedStoreCount = Math.max(0, Number(item.matchedStoreCount) || 0);
  const lowestStorePrice = positive(item.lowestStorePrice);
  if (matchedStoreCount >= 2 && lowestStorePrice) {
    availableWeight += 25;
    const ratio = price / lowestStorePrice;
    const points = ratio <= 1.01 ? 25 : ratio <= 1.03 ? 18 : ratio <= 1.07 ? 10 : 0;
    weightedPoints += points;
    signals.push("store_comparison");
    reasons.push(points === 25
      ? "Lowest or within 1% of the lowest price across " + matchedStoreCount + " matched stores"
      : "Best matched-store price is " + Math.round(lowestStorePrice) + " across " + matchedStoreCount + " stores");
  }

  if (signals.length < 2) {
    return {
      score: null,
      label: "Not enough verified data",
      confidence: "low",
      state: "insufficient_data",
      reasons: reasons.length ? reasons : ["DealMind needs at least two independent price signals."],
      signals
    };
  }

  const score = Math.round(weightedPoints / availableWeight * 100);
  const label = score >= 80 ? "Strong price signal"
    : score >= 60 ? "Worth a closer look"
    : score >= 40 ? "Average price signal"
    : "Weak price signal";
  const confidence = signals.length === 3 && observationCount >= 5 ? "high" : "medium";

  return {
    score,
    label,
    confidence,
    state: "assessed",
    reasons,
    signals,
    observationCount
  };
}

module.exports = { analyzeDeal };
