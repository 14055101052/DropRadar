const $ = (selector) => document.querySelector(selector);
const searchInput = $("#searchInput");
const searchNotice = $("#searchNotice");
const searchResults = $("#searchResults");
const searchButton = $("#searchButton");
const form = $("#addForm");
const list = $("#watchlistItems");
const toast = $("#toast");
let toastTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
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

function renderSearchResults(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    searchResults.innerHTML =
      '<div class="results-empty"><div class="results-empty-icon">⌕</div>' +
      '<strong>No matching products found</strong>' +
      '<p>Try a different keyword or a broader product name.</p></div>';
    searchResults.classList.remove("hidden");
    return;
  }

  const fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
  const timestamp = fetchedAt && !Number.isNaN(fetchedAt.getTime())
    ? " · Checked " + fetchedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  const cards = items.map((item) => {
    const title = escapeHtml(item.title);
    const brand = escapeHtml(item.brand || "Product");
    const imageUrl = safeHttpUrl(item.imageUrl);
    const productUrl = safeHttpUrl(item.productUrl);
    const price = formatMoney(item.price, item.currency || "INR");
    const mrp = Number(item.mrp);
    const actualPrice = Number(item.price);
    const hasMrp = Number.isFinite(mrp) && mrp > 0 && Number.isFinite(actualPrice) && mrp > actualPrice;
    const discount = Number(item.discountPercentage);
    const hasDiscount = Number.isFinite(discount) && discount > 0 && discount <= 99;
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

    return '<article class="product-card">' +
      '<div class="product-image">' + image + '</div>' +
      '<div class="product-body">' +
        '<div class="product-brand">' + brand + '</div>' +
        '<h3>' + title + '</h3>' +
        '<div class="price-row"><strong>' + escapeHtml(price) + '</strong>' +
          (hasMrp ? '<del class="mrp">' + escapeHtml(formatMoney(mrp, item.currency || "INR")) + '</del>' : '') +
          (hasDiscount ? '<span class="discount">' + Math.round(discount) + '% off</span>' : '') +
        '</div>' + stock +
        (specs ? '<div class="product-specs">' + specs + '</div>' : '') +
        '<div class="product-actions">' +
          '<button class="secondary-btn save-product" data-title="' + escapeHtml(item.title) +
            '" data-url="' + escapeHtml(productUrl || "") + '"' + (productUrl ? "" : " disabled") + '>＋ Save</button>' +
          (productUrl ? '<a class="retailer-link" href="' + escapeHtml(productUrl) +
            '" target="_blank" rel="noopener noreferrer">View at store ↗</a>' : '') +
        '</div>' +
      '</div></article>';
  }).join("");

  searchResults.innerHTML =
    '<div class="results-heading"><div><strong>' + items.length + ' ' +
    (items.length === 1 ? "result" : "results") + '</strong><span>from ' +
    escapeHtml(data.provider || "verified retailer") + timestamp +
    '</span></div><span class="source-label">Retailer data</span></div>' +
    '<div class="product-grid">' + cards + '</div>' +
    '<p class="results-disclaimer">Product information is provided by the retailer and may change. Confirm the final price, delivery and availability on the store website.</p>';

  searchResults.classList.remove("hidden");
  searchResults.querySelectorAll(".save-product").forEach((button) => {
    button.addEventListener("click", () => saveProduct(button));
  });
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
    const response = await fetch("/api/search?q=" + encodeURIComponent(query), {
      headers: { Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(data.message || data.error || "Product search is temporarily unavailable.");
      return;
    }
    renderSearchResults(data);
  } catch {
    showNotice("Could not reach DropRadar. Check your connection and try again.");
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = 'Search <span>→</span>';
  }
}

async function saveProduct(button) {
  const title = button.dataset.title;
  const url = safeHttpUrl(button.dataset.url);
  if (!url) { notify("This product does not have a valid retailer link."); return; }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Saving…";
  try {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url, targetPrice: "" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || "Could not save this product.");
    notify("Saved to your watchlist. " + (data.note || ""));
    await loadWatchlist();
  } catch (error) {
    notify(error.message || "Could not save this product.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

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
      '<p>Save a product link and set a target price to keep your shortlist organised.</p></div>';
    return;
  }
  list.innerHTML = items.map((item) =>
    '<article class="watch-item"><div class="watch-main">' +
      '<strong>' + escapeHtml(item.title) + '</strong>' +
      '<span>' + escapeHtml(item.merchant) + ' · ' + escapeHtml(item.url) + '</span>' +
    '</div><div class="watch-meta">' +
      (item.target_price ? '<span class="target">Target ' + escapeHtml(formatMoney(item.target_price)) + '</span>' : '') +
      '<span class="status">Saved · tracking not active</span>' +
      '<button class="remove-btn" data-remove="' + escapeHtml(item.id) + '" aria-label="Remove ' +
        escapeHtml(item.title) + '">×</button>' +
    '</div></article>'
  ).join("");

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
