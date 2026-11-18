(() => {
  const section = document.querySelector("#retailerBrowser");
  if (!section) return;

  const input = section.querySelector("#retailerSearch");
  const frame = section.querySelector("#retailerFrame");
  const openLink = section.querySelector("#retailerExternalLink");
  const status = section.querySelector("#retailerBrowserStatus");
  const buttons = [...section.querySelectorAll("[data-retailer]")];

  const stores = {
    amazon: { name: "Amazon", home: "https://www.amazon.in/", search: q => "https://www.amazon.in/s?k=" + encodeURIComponent(q) },
    flipkart: { name: "Flipkart", home: "https://www.flipkart.com/", search: q => "https://www.flipkart.com/search?q=" + encodeURIComponent(q) },
    myntra: { name: "Myntra", home: "https://www.myntra.com/", search: q => "https://www.myntra.com/search?q=" + encodeURIComponent(q) },
    croma: { name: "Croma", home: "https://www.croma.com/", search: q => "https://www.croma.com/searchB?q=" + encodeURIComponent(q) },
    ajio: { name: "AJIO", home: "https://www.ajio.com/", search: q => "https://www.ajio.com/search/?text=" + encodeURIComponent(q) },
    tatacliq: { name: "Tata CLiQ", home: "https://www.tatacliq.com/", search: q => "https://www.tatacliq.com/search/?searchCategory=all&text=" + encodeURIComponent(q) }
  };

  let activeStore = "amazon";
  let activeUrl = "";

  function setStatus(message) {
    status.textContent = message;
  }

  function buildUrl() {
    const store = stores[activeStore];
    const query = input.value.trim();
    return query ? store.search(query) : store.home;
  }

  function openStore() {
    const store = stores[activeStore];
    activeUrl = buildUrl();
    openLink.href = activeUrl;
    openLink.textContent = "Open " + store.name + " full page ↗";
    openLink.target = "_blank";
    section.classList.add("is-open");
    section.classList.toggle("is-external-only", activeStore === "amazon");

    buttons.forEach(button => {
      const selected = button.dataset.retailer === activeStore;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    if (activeStore === "amazon") {
      frame.src = "about:blank";
      frame.title = "Amazon opens in a full browser tab";
      setStatus("Amazon does not allow its website to be embedded in DropRadar. Opening it as a normal full-page website instead. Return to this tab to continue using DropRadar.");
      // This is a user-initiated top-level tab, not an attempt to bypass Amazon's frame policy.
      window.open(activeUrl, "_blank", "noopener,noreferrer");
      return;
    }

    frame.src = activeUrl;
    frame.title = store.name + " shopping website";
    setStatus("Trying to load " + store.name + " inside DropRadar. If the store blocks embedding, use the full-page link.");
  }

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      activeStore = button.dataset.retailer;
      openStore();
    });
  });

  section.querySelector("#retailerGo").addEventListener("click", openStore);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") openStore();
  });

  section.querySelector("#retailerClose").addEventListener("click", () => {
    frame.src = "about:blank";
    section.classList.remove("is-open", "is-external-only");
    setStatus("Choose a store to browse inside DropRadar.");
  });

  setStatus("Choose a store, enter a product, and browse. Amazon opens as a full-page website because it blocks embedded browsing.");
})();