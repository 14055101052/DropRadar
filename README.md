# DropRadar

A responsive shopping-discovery PWA with a Node.js API, product-link watchlist, side-by-side comparison UI, and optional PostgreSQL storage.

## Run locally

1. Install Node.js 24.22.1.
2. Run \`npm install\`.
3. Run \`npm start\`.
4. Open http://localhost:3000.

Without \`DATABASE_URL\`, local development uses SQLite at \`dropradar.db\`.
With \`DATABASE_URL\`, the API uses PostgreSQL. Keep connection strings private.

## Current product experience

- Multi-store filter bar: Best From All Stores, Amazon, Flipkart, Myntra, Croma, AJIO and Tata CLiQ.
- Best From All Stores sorts verified listings by ascending current price.
- Product cards support direct retailer links and one-tap watchlist saving.
- Selecting one to three listings opens a side-by-side comparison table.
- Comparison fields include store, current price, delivery estimate, seller rating and return policy.
- Missing fields are shown as "Not supplied"; no store detail is guessed.
- The buying verdict is currently a transparent price comparison rule, not an AI-generated recommendation.
- Watchlist items allow target-price editing.
- Server-side category safety checks apply to search and saved item titles.
- PostgreSQL setup is optional; local SQLite is available for development.
- PWA manifest and service-worker shell caching.
- API health at \`/api/health\` and store metadata at \`/api/stores\`.

## Product data integrations

There are currently **no live retailer product feeds connected**. The search endpoint returns an explicit unavailable response rather than sample listings or fabricated prices.

No affiliate tracking is used. Buy Now opens the exact retailer product URL supplied by a connected data source, without adding an affiliate tag.

Amazon's current product catalog API requires an Amazon Associates account and API eligibility. Flipkart's product search API is limited to registered Flipkart Affiliate Program users. Those integrations are therefore not part of the current no-commission build.

Before connecting another data provider, verify its store coverage, free-tier limits, data freshness, permitted use, and whether it returns direct retailer URLs. Do not scrape or bypass store protections. Store fields such as delivery estimates, seller ratings and returns must only be shown when supplied by a verified source.

## Current limitations

- Search UI is ready, but live product search waits for a non-affiliate, terms-compliant provider.
- Automatic price monitoring, price history and price-drop notifications are not implemented.
- Watchlist saves links and optional target prices; this is not yet automatic monitoring.
- SQLite fallback on Render Free is temporary: local filesystem data can disappear across deploys or restarts.
- No user authentication or multi-user isolation has been implemented. Treat this deployment as a private development build, not a public production shopping service.
- The smart verdict only compares supplied prices. It does not score seller reliability or generate an AI recommendation.
