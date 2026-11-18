const $ = (selector) => document.querySelector(selector);
const searchInput = $("#searchInput");
const searchNotice = $("#searchNotice");
const searchResults = $("#searchResults");
const searchButton = $("#searchButton");
const form = $("#addForm");
const list = $("#watchlistItems");
const toast = $("#toast");
let toastTimer;
let currentSearchItems = [];
let activeStore = "all";
const compareSelection = new Set();

const STORE_NAMES = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  myntra: "Myntra",
  croma: "Croma",
  ajio: "AJIO",
  tatacliq: "Tata CLiQ"
};

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function showNotice(message, kind = "warning") {
  searchNotice.textContent = message;
  searchNotice.dataset.kind = kind;
  searchNotice.classList.remove("hidden");
}

function clearNotice() {
  searchNotice.textContent = "";
  searchNotice.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function formatMoney(value, currency = "INR") {
  if (value === null || value === undefined || value === "") return "Price unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Price unavailable";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency", currency, maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return currency + " " + amount.toLocaleString("en-IN");
  }
}

function storeIdFor(item) {
  const raw = String(item.storeId || item.merchant || item.store || "").toLowerCase();
  if (raw.includes("amazon")) return "amazon";
  if (raw.includes("flipkart")) return "flipkart";
  if (raw.includes("myntra")) return "myntra";
  if (raw.includes("croma")) return "croma";
  if (raw.includes("ajio")) return "ajio";
  if (raw.includes("tata") || raw.includes("tatacliq")) return "tatacliq";
  return "other";
}

function updateStoreFilterButtons() {
  document.querySelectorAll("[data-store]").forEach((button) => {
    const selected = button.dataset.store === activeStore;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function filteredItems() {
  const selected = activeStore === "all"
    ? currentSearchItems.slice()
    : currentSearchItems.filter((item) => storeIdFor(item) === activeStore);
  if (activeStore === "all") {
    selected.sort((a, b) => {
      const ap = Number(a.price);
      const bp = Number(b.price);
      const aValid = Number.isFinite(ap) && ap > 0;
      const bValid = Number.isFinite(bp) && bp > 0;
      if (aValid && bValid) return ap - bp;
      if (aValid) return -1;
      if (bValid) return 1;
      return 0;
    });
  }
  return selected;
}

function renderSearchResults() {
  const items = filteredItems();
  compareSelection.clear();

  if (!items.length) {
    const storeName = activeStore === "all" ? "connected stores" : STORE_NAMES[activeStore];
    searchResults.innerHTML =
      '<div class="results-empty"><div class="results-empty-icon">⌕</div>' +
      '<strong>No verified listings found</strong>' +
      '<p>No verified listings currently match this search in ' + escapeHtml(storeName) +
      '. DropRadar will not fill this space with sample prices.</p></div>';
    searchResults.classList.remove("hidden");
    return;
  }

  const cards = items.map((item, index) => {
    const title = escapeHtml(item.title);
    const brand = escapeHtml(item.brand || "Product");
    const imageUrl = safeHttpUrl(item.imageUrl);
    const productUrl = safeHttpUrl(item.productUrl || item.url);
    const price = formatMoney(item.price, item.currency || "INR");
    const mrp = Number(item.mrp);
    const actualPrice = Number(item.price);
    const hasMrp = Number.isFinite(mrp) && mrp > 0 && Number.isFinite(actualPrice) && mrp > actualPrice;
    const discount = Number(item.discountPercentage);
    const hasDiscount = Number.isFinite(discount) && discount > 0 && discount <= 99;
    const merchant = escapeHtml(item.merchant || item.store || "Store not identified");
    const stock = item.inStock === true
      ? '<span class="stock-status in-stock">In stock</span>'
      : item.inStock === false
        ? '<span class="stock-status out-stock">Out of stock</span>'
        : '<span class="stock-status">Stock not confirmed</span>';
    const specs = Array.isArray(item.keySpecs)
      ? item.keySpecs.slice(0, 3).map((spec) => '<span>' + escapeHtml(spec) + '</span>').join("")
      : "";
    const image = imageUrl
      ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + title + '" loading="lazy" referrerpolicy="no-referrer">'
      : '<div class="product-placeholder" aria-hidden="true">◇</div>';
    const buyLabel = "Buy Now at " + (actualPrice > 0 ? formatMoney(actualPrice, item.currency || "INR") : "Store");
    const buyAction = productUrl
      ? '<a class="buy-now" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(buyLabel) + ' ↗</a>'
      : '<span class="buy-now disabled">Store link unavailable</span>';

    return '<article class="product-card" data-product-index="' + index + '" tabindex="0" role="button" aria-label="Select ' + title + ' for comparison">' +
      '<div class="product-image">' + image + '</div>' +
      '<div class="product-body">' +
        '<div class="product-card-top"><span class="product-brand">' + brand + '</span><span class="store-tag">' + merchant + '</span></div>' +
        '<h3>' + title + '</h3>' +
        '<div class="price-row"><strong>' + escapeHtml(price) + '</strong>' +
          (hasMrp ? '<del class="mrp">' + escapeHtml(formatMoney(mrp, item.currency || "INR")) + '</del>' : '') +
          (hasDiscount ? '<span class="discount">' + Math.round(discount) + '% off</span>' : '') +
        '</div>' + stock +
        (specs ? '<div class="product-specs">' + specs + '</div>' : '') +
        '<div class="product-actions">' + buyAction +
          '<button class="track-product" data-track-index="' + index + '">Track Price Drop 🔔</button>' +
        '</div>' +
      '</div></article>';
  }).join("");

  searchResults.innerHTML =
    '<div class="results-heading"><div><strong>' + items.length + ' ' +
    (items.length === 1 ? "listing" : "listings") + '</strong><span>Lowest listed prices first · Select a listing to compare</span></div>' +
    '<span class="source-label">Retailer data</span></div>' +
    '<div class="product-grid">' + cards + '</div>' +
    '<section id="comparisonPanel" class="comparison-shell hidden" aria-live="polite"></section>' +
    '<p class="results-disclaimer">Prices, stock and store details can change. Confirm the final price, delivery and returns on the store website. Buy Now opens the retailer directly; no affiliate tag is added.</p>';

  searchResults.classList.remove("hidden");
  searchResults.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", () => selectForCompare(Number(card.dataset.productIndex)));
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectForCompare(Number(card.dataset.productIndex));
      }
    });
  });
  searchResults.querySelectorAll(".buy-now").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
  searchResults.querySelectorAll("[data-track-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      trackProduct(items[Number(button.dataset.trackIndex)], button);
    });
  });
}

function selectForCompare(index) {
  const items = filteredItems();
  const product = items[index];
  if (!product) return;

  if (compareSelection.has(index)) {
    compareSelection.delete(index);
  } else {
    if (compareSelection.size >= 3) {
      notify("Compare up to 3 listings at a time.");
      return;
    }
    compareSelection.add(index);
  }
  renderComparisonPanel();
  searchResults.querySelectorAll(".product-card").forEach((card) => {
    card.classList.toggle("selected", compareSelection.has(Number(card.dataset.productIndex)));
  });
}

function renderComparisonPanel() {
  const panel = $("#comparisonPanel");
  if (!panel) return;
  const items = filteredItems();
  const selected = Array.from(compareSelection).map((index) => items[index]).filter(Boolean);
  if (!selected.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const priceRows = selected
    .map((item) => ({ item, price: Number(item.price) }))
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
    .sort((a, b) => a.price - b.price);

  let verdict = "Select more listings to compare their verified prices.";
  if (priceRows.length === 1) {
    verdict = "The selected listing is " + (priceRows[0].item.merchant || "from this store") +
      " at " + formatMoney(priceRows[0].price, priceRows[0].item.currency || "INR") +
      ". Add another listing to compare prices.";
  } else if (priceRows.length > 1) {
    const lowest = priceRows[0];
    const second = priceRows[1];
    const gap = second.price - lowest.price;
    verdict = gap === 0
      ? "The lowest listed price is tied at " + formatMoney(lowest.price, lowest.item.currency || "INR") + "."
      : "Lowest listed price: " + (lowest.item.merchant || "Selected store") + " at " +
        formatMoney(lowest.price, lowest.item.currency || "INR") + " — " +
        formatMoney(gap, lowest.item.currency || "INR") + " below the next selected listing.";
  }

  const headers = selected.map((item, index) =>
    '<th scope="col"><span class="compare-store">' + escapeHtml(item.merchant || item.store || ("Listing " + (index + 1))) +
    '</span><span class="compare-product-name">' + escapeHtml(item.title || "Product") + '</span></th>'
  ).join("");
  const getValue = (item, key, fallback) => {
    const value = item[key];
    return value === null || value === undefined || value === "" ? fallback : escapeHtml(value);
  };
  const rows = [
    ["Current price", (item) => escapeHtml(formatMoney(item.price, item.currency || "INR"))],
    ["Delivery estimate", (item) => getValue(item, "deliveryEstimate", "Not supplied")],
    ["Seller rating", (item) => item.sellerRating == null ? "Not supplied" : escapeHtml(item.sellerRating)],
    ["Return policy", (item) => getValue(item, "returnPolicy", "Not supplied")]
  ];
  const body = rows.map(([label, render]) =>
    '<tr><th scope="row">' + label + '</th>' + selected.map((item) => '<td>' + render(item) + '</td>').join("") + '</tr>'
  ).join("");

  panel.innerHTML =
    '<div class="verdict-card"><div class="verdict-kicker">DROPRADAR BUYING VERDICT</div><strong>' +
    escapeHtml(verdict) + '</strong><p>This verdict compares only the fields supplied by connected stores. Delivery, seller ratings and return terms are not guessed. It is a transparent price rule, not an AI-generated recommendation.</p></div>' +
    '<div class="comparison-heading"><div><strong>Side-by-side comparison</strong><span>' + selected.length + ' selected listing' + (selected.length === 1 ? "" : "s") + '</span></div>' +
    '<button type="button" id="clearCompare" class="text-btn">Clear selection</button></div>' +
    '<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th scope="col">Details</th>' +
    headers + '</tr></thead><tbody>' + body + '</tbody></table></div>';

  panel.classList.remove("hidden");
  $("#clearCompare").addEventListener("click", () => {
    compareSelection.clear();
    renderComparisonPanel();
    searchResults.querySelectorAll(".product-card").forEach((card) => card.classList.remove("selected"));
  });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function search() {
  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchResults.classList.add("hidden");
    showNotice("Type at least two characters to search.");
    return;
  }

  searchButton.disabled = true;
  searchButton.textContent = "Searching…";
  clearNotice();
  searchResults.classList.add("hidden");

  try {
    const response = await fetch("/api/search?q=" + encodeURIComponent(query) + "&store=" + encodeURIComponent(activeStore), {
      headers: { Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.code === "PRODUCT_DATA_SOURCES_NOT_CONNECTED") {
        showNotice("Your search is ready, but live retailer data feeds are not connected yet. We are keeping results empty rather than showing invented products, prices, ratings or delivery promises.");
      } else {
        showNotice(data.message || data.error || "Product search is temporarily unavailable.");
      }
      return;
    }
    currentSearchItems = Array.isArray(data.items) ? data.items : [];
    renderSearchResults();
  } catch {
    showNotice("Could not reach DropRadar. Check your connection and try again.");
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = 'Search <span>→</span>';
  }
}

async function trackProduct(item, button) {
  const url = safeHttpUrl(item.productUrl || item.url);
  if (!url) { notify("This listing does not include a valid retailer product link."); return; }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title, url, targetPrice: "" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || "Could not save this product.");
    notify(data.note || "Saved to your watchlist.");
    await loadWatchlist();
  } catch (error) {
    notify(error.message || "Could not save this product.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.querySelectorAll("[data-store]").forEach((button) => {
  button.addEventListener("click", () => {
    activeStore = button.dataset.store;
    updateStoreFilterButtons();
    if (searchInput.value.trim().length >= 2) search();
    else showNotice("Choose a product search first. Store filters will apply to its verified listings.");
  });
});

searchButton.addEventListener("click", search);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") search();
});
document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    searchInput.value = button.dataset.query;
    searchInput.focus();
    search();
  });
});

$("#toggleAdd").addEventListener("click", () => {
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) form.elements.title.focus();
});
$("#cancelAdd").addEventListener("click", () => form.classList.add("hidden"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const payload = {
    title: values.get("title"),
    url: values.get("url"),
    targetPrice: values.get("targetPrice")
  };
  try {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || "Could not save this link.");
    form.reset();
    form.classList.add("hidden");
    notify(data.note || "Saved to your watchlist.");
    await loadWatchlist();
  } catch (error) {
    notify(error.message || "Could not save this link.");
  }
});

async function setTargetPrice(id, value) {
  const target = value.trim();
  if (target !== "" && (!Number.isFinite(Number(target)) || Number(target) <= 0)) {
    notify("Enter a target price greater than zero.");
    return;
  }
  try {
    const response = await fetch("/api/watchlist/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPrice: target })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not update target price.");
    notify("Target price saved. Automatic alerts are not active yet.");
    await loadWatchlist();
  } catch (error) {
    notify(error.message || "Could not update target price.");
  }
}

async function loadWatchlist() {
  try {
    const response = await fetch("/api/watchlist");
    if (!response.ok) throw new Error("Watchlist request failed.");
    const data = await response.json();
    renderWatchlist(data.items || []);
  } catch {
    list.innerHTML = '<div class="empty-state"><strong>Could not load your watchlist</strong>' +
      '<p>Refresh the page or check your connection.</p></div>';
  }
}

function renderWatchlist(items) {
  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">♡</div>' +
      '<strong>Your watchlist starts here</strong>' +
      '<p>Track a product from search or add its link manually.</p></div>';
    return;
  }
  list.innerHTML = items.map((item) =>
    '<article class="watch-item"><div class="watch-main">' +
      '<strong>' + escapeHtml(item.title) + '</strong>' +
      '<span>' + escapeHtml(item.merchant) + ' · ' + escapeHtml(item.url) + '</span>' +
    '</div><div class="watch-meta">' +
      (item.target_price ? '<span class="target">Target ' + escapeHtml(formatMoney(item.target_price)) + '</span>' : '') +
      '<span class="status">Saved · monitoring not active</span>' +
      '<button class="set-target-btn" data-set-target="' + escapeHtml(item.id) + '">Set target</button>' +
      '<button class="remove-btn" data-remove="' + escapeHtml(item.id) + '" aria-label="Remove ' +
        escapeHtml(item.title) + '">×</button>' +
      '<form class="target-form hidden" data-target-form="' + escapeHtml(item.id) + '">' +
        '<input name="targetPrice" type="number" min="1" step="1" placeholder="Target price in ₹" value="' +
        (item.target_price ? escapeHtml(item.target_price) : '') + '" aria-label="Target price">' +
        '<button class="primary-btn" type="submit">Save target</button>' +
      '</form>' +
    '</div></article>'
  ).join("");

  list.querySelectorAll("[data-set-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetForm = list.querySelector('[data-target-form="' + CSS.escape(button.dataset.setTarget) + '"]');
      if (targetForm) targetForm.classList.toggle("hidden");
    });
  });
  list.querySelectorAll("[data-target-form]").forEach((targetForm) => {
    targetForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = new FormData(targetForm).get("targetPrice");
      setTargetPrice(targetForm.dataset.targetForm, String(value || ""));
    });
  });
  list.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await fetch("/api/watchlist/" + encodeURIComponent(button.dataset.remove), {
          method: "DELETE"
        });
        if (!response.ok) throw new Error();
        notify("Removed from your watchlist.");
        await loadWatchlist();
      } catch {
        button.disabled = false;
        notify("Could not remove this item.");
      }
    });
  });
}

$("#refreshButton").addEventListener("click", loadWatchlist);
loadWatchlist();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
