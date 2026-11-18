# DropRadar

DropRadar is a shopping-discovery and price-intelligence PWA. The intended flow is **discover → compare → evaluate → track → buy**. It combines the original DropRadar link tracker with DealMind-style discovery, deal intelligence and smart recommendations.

## Run locally

1. Install Node.js 24.22.1.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

Without `DATABASE_URL`, local development uses SQLite at `dropradar.db`. With `DATABASE_URL`, the API uses PostgreSQL. Keep connection strings private.

## Product experience

- One search entry point for product discovery across connected stores.
- Store filters for Amazon, Flipkart, Myntra, Croma, AJIO and Tata CLiQ.
- Product cards support verified product details, retailer links and watchlist saving when a data provider is connected.
- Select up to three listings for side-by-side comparison.
- Compare only supplied fields; missing delivery, seller and returns data is never guessed.
- Paste a product URL into the watchlist and optionally set a target price.
- PWA manifest and service-worker shell caching.

The embedded retailer browser was removed. DropRadar is intended to show product listings and comparisons in its own experience; Buy Now hands the user to the retailer's own app or website.

## Product data and affiliate integrations

There are currently **no live retailer product feeds connected**. The search endpoint returns an explicit unavailable response rather than sample listings or fabricated prices.

An Amazon Associates tracking ID is a link-attribution ID; it does not by itself grant programmatic access to Amazon's product catalogue. Amazon's current Creators API is the successor to PA-API 5. Its published prerequisites include enrolment in the target marketplace, at least 10 qualifying sales in the previous 30 days, API registration and API credentials. See the [Amazon Creators API prerequisites](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction).

Cuelinks provides affiliate campaign discovery, offer/coupon data, link conversion and reporting. Its support documentation explicitly says its API does **not** provide merchant product feeds. It therefore cannot, by itself, power keyword-based product catalogue search. See [Cuelinks API documentation](https://developers.cuelinks.com/docs/) and [Cuelinks feed clarification](https://cuelinks.zohodesk.com/portal/en/kb/articles/what-are-the-different-types-of-apis-available).

Affiliate link attribution and product catalogue data are separate integrations. DropRadar must only display current product data supplied by an approved, terms-compliant source. Do not scrape retailer pages or bypass store protections.

## Current limitations

- Search UI and comparison UI are present, but live product search is waiting for an eligible data provider.
- Amazon product catalogue integration is not active; the Associates ID alone is not sufficient.
- Automatic price monitoring, price history and price-drop/restock notifications are not implemented.
- Watchlist currently saves product links and optional target prices; it does not automatically monitor prices.
- SQLite fallback on Render Free is temporary; local filesystem data can disappear across deploys or restarts.
- No user authentication or multi-user isolation has been implemented. Treat this deployment as a private development build, not a public production shopping service.
- The current comparison verdict is a transparent price rule, not an AI-generated recommendation.
