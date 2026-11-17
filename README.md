# DropRadar

Responsive shopping discovery PWA with a Node.js API, product-link watchlist, and optional hosted PostgreSQL storage.

## Run locally

1. Install Node.js 24.22.1.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Without `DATABASE_URL`, local development uses SQLite at `dropradar.db`.
With `DATABASE_URL`, the API uses PostgreSQL. Keep connection strings private.

## Included

- Responsive shopping-focused interface.
- Product search interface with an explicit unavailable-provider state.
- Product-link watchlist with title, merchant, and optional target price.
- Duplicate-link validation and delete.
- PostgreSQL driver and automatic watchlist table setup when `DATABASE_URL` is configured.
- Local SQLite fallback for development only.
- PWA manifest and service-worker shell caching.
- API health endpoint at `/api/health`.

## Hosted database setup (Neon example)

1. Create a PostgreSQL project with your database provider.
2. Copy its pooled or standard PostgreSQL connection string.
3. In the Render service dashboard, add it as the secret environment variable `DATABASE_URL`.
4. Keep the provider's SSL requirement in the connection string (for Neon, use the connection string supplied by Neon).
5. Save the environment variable and redeploy. Check `/api/health`; its `storage` field should report `hosted-postgresql`.

Do not paste database passwords or full connection strings into public GitHub files, source code, or chat. Use the hosting provider's secret environment-variable settings.

Neon Free currently advertises 1 GB of storage and 100 compute-hours per project per month. Compute may scale down when idle; review current limits before relying on it for user-facing production data.

## Important current limitations

- Product search is not connected to a real catalog yet. The API deliberately returns `503 SEARCH_PROVIDER_NOT_CONFIGURED`.
- Live retailer prices, price history, stock checks, AI recommendations, affiliate deep links, and notifications are not connected.
- SQLite fallback on Render Free is temporary: local filesystem data can disappear across deploys/restarts. Configure hosted PostgreSQL before saving real user data.
- No user authentication or multi-user isolation has been implemented yet. Treat this deployment as a private development build, not a public production shopping service.
