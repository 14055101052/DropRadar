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
    frame.src = activeUrl;
    frame.title = store.name + " shopping website";
    openLink.href = activeUrl;
    openLink.textContent = "Open " + store.name + " outside DropRadar ↗";
    section.classList.add("is-open");
    setStatus("Trying to load " + store.name + " inside DropRadar. If the store blocks embedding or the panel stays blank, use the external link.");
    buttons.forEach(button => {
      const selected = button.dataset.retailer === activeStore;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
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
    section.classList.remove("is-open");
    setStatus("Choose a store to browse inside DropRadar.");
  });

  // Start with a ready-to-use retailer browser, without loading a third-party page
  // until the user explicitly chooses a store.
  setStatus("Choose a store, enter a product, and try browsing without leaving DropRadar.");
})();
