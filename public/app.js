const $ = (selector) => document.querySelector(selector);
const searchInput = $("#searchInput");
const searchNotice = $("#searchNotice");
const searchResults = $("#searchResults");
const searchButton = $("#searchButton");
const form = $("#addForm");
const list = $("#watchlistItems");
const toast = $("#toast");
const accountPanel = $("#accountPanel");
let signedInUser = null;
let authMode = "signup";
let toastTimer;
let currentSearchItems = [];
let activeStore = "all";

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

function groupCatalogItems(items) {
  const groups = new Map();
  items.forEach((item, index) => {
    // Only a shared canonical product ID proves that offers are the same product.
    const key = item.productId ? "product:" + item.productId : "offer:" + (item.offerId || item.productUrl || index);
    if (!groups.has(key)) groups.set(key, { product: item, offers: [] });
    groups.get(key).offers.push({ item, index });
  });
  return Array.from(groups.values()).map((group) => {
    group.offers.sort((a, b) => {
      const ap = Number(a.item.price), bp = Number(b.item.price);
      const av = Number.isFinite(ap) && ap > 0, bv = Number.isFinite(bp) && bp > 0;
      if (av && bv) return ap - bp;
      if (av) return -1;
      if (bv) return 1;
      return 0;
    });
    const prices = group.offers.map((entry) => Number(entry.item.price)).filter((price) => Number.isFinite(price) && price > 0);
    group.lowestPrice = prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
    return group;
  }).sort((a, b) => a.lowestPrice - b.lowestPrice);
}

function formatLastChecked(value) {
  if (!value) return "Update time not supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";
  return "Feed checked " + new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}

function comparisonVerdict(offers) {
  const priced = offers.map((entry) => entry.item).filter((item) => {
    const price = Number(item.price);
    return Number.isFinite(price) && price > 0;
  });
  const byStore = new Map();
  for (const item of priced) {
    const store = storeIdFor(item);
    const existing = byStore.get(store);
    if (!existing || Number(item.price) < Number(existing.price)) byStore.set(store, item);
  }
  const storeOffers = Array.from(byStore.values());
  if (storeOffers.length < 2) {
    return "Only one retailer has a verified price for this product right now. A cross-store winner cannot be determined yet.";
  }
  const currencies = new Set(storeOffers.map((item) => String(item.currency || "INR").toUpperCase()));
  if (currencies.size !== 1) {
    return "Offers use different currencies, so DropRadar is not ranking them against each other.";
  }
  storeOffers.sort((a, b) => Number(a.price) - Number(b.price));
  const lowest = storeOffers[0], next = storeOffers[1];
  const gap = Number(next.price) - Number(lowest.price);
  if (gap === 0) {
    return "Lowest listed price is tied at " + formatMoney(lowest.price, lowest.currency || "INR") +
      " across " + storeOffers.filter((item) => Number(item.price) === Number(lowest.price)).length + " retailers.";
  }
  return (lowest.merchant || "One retailer") + " has the lowest listed price at " +
    formatMoney(lowest.price, lowest.currency || "INR") + " — " +
    formatMoney(gap, lowest.currency || "INR") + " less than the next retailer.";
}

function renderSearchResults() {
  const items = filteredItems();
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

  const groups = groupCatalogItems(items);
  const cards = groups.map((group) => {
    const product = group.product;
    const title = escapeHtml(product.title || "Verified product");
    const brand = escapeHtml(product.brand || "Product");
    const model = product.model ? '<span class="product-model">' + escapeHtml(product.model) + '</span>' : "";
    const imageUrl = safeHttpUrl(product.imageUrl) || safeHttpUrl(group.offers.map((entry) => entry.item.imageUrl).find(Boolean));
    const image = imageUrl
      ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + title + '" loading="lazy" referrerpolicy="no-referrer">'
      : '<div class="product-placeholder" aria-hidden="true">◇</div>';

    const offers = group.offers.map((entry) => {
      const item = entry.item;
      const merchant = escapeHtml(item.merchant || STORE_NAMES[item.storeId] || "Store not identified");
      const priceNumber = Number(item.price);
      const hasPrice = Number.isFinite(priceNumber) && priceNumber > 0;
      const price = hasPrice ? formatMoney(priceNumber, item.currency || "INR") : "Price unavailable";
      const mrp = Number(item.mrp);
      const hasMrp = hasPrice && Number.isFinite(mrp) && mrp > priceNumber;
      const discount = Number(item.discountPercentage);
      const hasDiscount = Number.isFinite(discount) && discount > 0 && discount <= 99;
      const stock = item.inStock === true
        ? '<span class="stock-status in-stock">In stock</span>'
        : item.inStock === false
          ? '<span class="stock-status out-stock">Out of stock</span>'
          : '<span class="stock-status">Stock not confirmed</span>';
      const productUrl = safeHttpUrl(item.productUrl || item.url);
      const buy = productUrl
        ? '<a class="buy-now" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener noreferrer">View at store ↗</a>'
        : '<span class="buy-now disabled">Store link unavailable</span>';
      return '<div class="offer-row">' +
        '<div class="offer-store"><strong>' + merchant + '</strong><span>' + escapeHtml(formatLastChecked(item.lastSeenAt)) + '</span></div>' +
        '<div class="offer-price"><strong>' + escapeHtml(price) + '</strong>' +
          (hasMrp ? '<del class="mrp">' + escapeHtml(formatMoney(mrp, item.currency || "INR")) + '</del>' : '') +
          (hasDiscount ? '<span class="discount">' + Math.round(discount) + '% off MRP</span>' : '') +
        '</div><div class="offer-stock">' + stock + '</div>' +
        '<div class="offer-actions">' + buy +
          '<button class="track-product" data-track-index="' + entry.index + '">Track price</button></div></div>';
    }).join("");

    return '<article class="comparison-product-card">' +
      '<div class="comparison-product-summary"><div class="product-image">' + image + '</div>' +
      '<div class="comparison-product-info"><span class="product-brand">' + brand + '</span>' +
      '<h3>' + title + '</h3>' + model +
      '<span class="offer-count">' + group.offers.length + ' verified retailer ' +
        (group.offers.length === 1 ? "offer" : "offers") + '</span></div></div>' +
      '<div class="comparison-verdict"><span>PRICE CHECK</span><strong>' +
        escapeHtml(comparisonVerdict(group.offers)) + '</strong></div>' +
      '<div class="offer-list">' + offers + '</div>' +
      '<p class="comparison-note">Prices and availability can change. This compares the same catalogue product ID only. Confirm final price, seller, delivery and returns at the retailer.</p>' +
      '</article>';
  }).join("");

  const offerCount = items.length;
  searchResults.innerHTML =
    '<div class="results-heading"><div><strong>' + groups.length + ' ' +
    (groups.length === 1 ? "product" : "products") + ' · ' + offerCount + ' retailer ' +
    (offerCount === 1 ? "offer" : "offers") + '</strong><span>Same-product offers grouped together · Lowest listed prices first</span></div>' +
    '<span class="source-label">Verified catalogue</span></div>' +
    '<div class="comparison-product-list">' + cards + '</div>' +
    '<p class="results-disclaimer">Retailer data only. If a store does not provide a field, DropRadar leaves it blank instead of guessing. Buy Now opens the retailer directly; no affiliate tag is added.</p>';
  searchResults.classList.remove("hidden");
  searchResults.querySelectorAll("[data-track-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      trackProduct(items[Number(button.dataset.trackIndex)], button);
    });
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
  if (!signedInUser) { notify("Create an account or sign in to save products."); accountPanel.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const url = safeHttpUrl(item.productUrl || item.url);
  if (!url) { notify("This listing does not include a valid retailer product link."); return; }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title, url, targetPrice: "", productId: item.productId, offerId: item.offerId })
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
  if (!signedInUser) { notify("Sign in to save products to your personal watchlist."); accountPanel.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
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

function renderAccount() {
  if (!signedInUser) {
    accountPanel.innerHTML =
      '<div class="account-copy"><strong>Your own shopping shortlist</strong>' +
      '<p>Create an account or sign in to save products and keep your watchlist private.</p></div>' +
      '<form id="authForm" class="account-form">' +
      '<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="Email address" aria-label="Email address">' +
      '<input name="password" type="password" autocomplete="' + (authMode === "signup" ? "new-password" : "current-password") + '" minlength="10" maxlength="128" required placeholder="Password (10+ characters)" aria-label="Password">' +
      '<button class="primary-btn" type="submit">' + (authMode === "signup" ? "Create account" : "Sign in") + '</button>' +
      '<button class="account-toggle" id="authModeToggle" type="button">' + (authMode === "signup" ? "Already registered? Sign in" : "New to DropRadar? Create account") + '</button>' +
      '<p class="account-note">Your password is stored as a one-way scrypt hash. Use a unique password that you do not reuse elsewhere.</p>' +
      '<p id="authError" class="account-error" role="alert"></p></form>';
    $("#authModeToggle").addEventListener("click", () => {
      authMode = authMode === "signup" ? "login" : "signup";
      renderAccount();
    });
    $("#authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#authForm button[type=submit]");
      const values = new FormData(event.currentTarget);
      button.disabled = true;
      button.textContent = authMode === "signup" ? "Creating…" : "Signing in…";
      $("#authError").textContent = "";
      try {
        const response = await fetch("/api/auth/" + authMode, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: values.get("email"), password: values.get("password") })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not authenticate.");
        signedInUser = data.user;
        renderAccount();
        notify(authMode === "signup" ? "Your DropRadar account is ready." : "Welcome back.");
        await loadWatchlist();
      } catch (error) {
        $("#authError").textContent = error.message || "Could not sign in.";
        button.disabled = false;
        button.textContent = authMode === "signup" ? "Create account" : "Sign in";
      }
    });
    return;
  }
  accountPanel.innerHTML =
    '<div class="account-copy"><strong>Your DropRadar account</strong>' +
    '<p>Your saved products are linked to this account.</p></div>' +
    '<div class="account-actions"><span class="account-email">' + escapeHtml(signedInUser.email) + '</span>' +
    '<button id="logoutButton" type="button" class="text-btn">Sign out</button></div>';
  $("#logoutButton").addEventListener("click", async () => {
    const button = $("#logoutButton");
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error();
      signedInUser = null;
      renderAccount();
      renderWatchlist([]);
      notify("You have signed out.");
    } catch {
      button.disabled = false;
      notify("Could not sign out. Please try again.");
    }
  });
}

async function initializeAccount() {
  try {
    const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    const data = await response.json();
    signedInUser = data.user || null;
  } catch {
    signedInUser = null;
  }
  renderAccount();
  await loadWatchlist();
}

async function loadWatchlist() {
  if (!signedInUser) {
    renderWatchlist([]);
    return;
  }
  try {
    const response = await fetch("/api/watchlist", { headers: { Accept: "application/json" } });
    if (response.status === 401) {
      signedInUser = null;
      renderAccount();
      renderWatchlist([]);
      return;
    }
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
      (item.current_price != null ? '<span>Last recorded: ' + escapeHtml(formatMoney(item.current_price, item.currency || "INR")) + '</span>' : '') +
    '</div><div class="watch-meta">' +
      (item.target_price ? '<span class="target">Target ' + escapeHtml(formatMoney(item.target_price)) + '</span>' : '') +
      '<span class="status">' + (item.offer_id ? 'Saved · automatic checks not active' : 'Saved link · no verified listing linked') + '</span>' +
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
initializeAccount();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
