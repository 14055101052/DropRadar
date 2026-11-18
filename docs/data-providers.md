# DropRadar product data providers

DropRadar only displays retailer data after a provider has supplied it. Never add scraped, guessed, fixture, or manually invented listings to production.

## Flipkart Affiliate API

The first live adapter is implemented in `providers/flipkart.js`.

It uses Flipkart's documented v1 keyword search endpoint:

`https://affiliate-api.flipkart.net/affiliate/1.0/search.json`

The provider sends the official `Fk-Affiliate-Id` and `Fk-Affiliate-Token` headers, requests up to 10 results, validates/maps the returned fields, and upserts them into the catalogue and price history.

Configure these server-side environment variables on the Render service:

- `FLIPKART_AFFILIATE_ID`
- `FLIPKART_AFFILIATE_TOKEN`

Never place either value in browser JavaScript, Git, or a public response. The adapter remains inactive when either value is absent. Flipkart's API documentation says API access is for registered affiliates and documents token generation in Affiliate > API > API Token.

Official references:
- https://affiliate.flipkart.com/api-docs/af_overview.html
- https://affiliate.flipkart.com/api-docs/af_register.html
- https://affiliate.flipkart.com/api-docs/af_prod_ref.html

## Amazon India

Amazon's supported catalogue integration is Creators API; PA-API 5 is deprecated. Creators API supports keyword search, item details, and variations. Amazon's current documentation lists Associates enrolment, at least 10 qualifying sales in the previous 30 days, API registration, and credentials as prerequisites. An Associates tracking ID alone is not API access.

Official references:
- https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction
- https://affiliate-program.amazon.in/creatorsapi/docs/en-us/paapiv5-deprecation

No Amazon adapter is enabled until valid Creators API access exists.

## Cuelinks

Cuelinks APIs cover campaigns, links, offers, and transactions. Cuelinks support explicitly says its API does not provide advertiser/merchant product feeds. It therefore cannot be used as DropRadar's product catalogue source by itself.

Official references:
- https://cuelinks.zohodesk.com/portal/en/kb/articles/what-are-the-different-types-of-apis-available
- https://cuelinks.zohodesk.com/portal/en/kb/articles/what-are-cuelinks-apis

## Admitad product feeds

Some merchant programs provide downloadable product feeds (CSV/XML), but feed availability is program-specific and depends on publisher access/approval. A product-feed tool is not a universal API for every merchant. Croma is listed in Admitad India with a Product Feed tool; availability must be confirmed inside the approved publisher account before wiring it.

Official references:
- https://www.admitad.com/en-in/store/product-feed/
- https://www.admitad.com/store/offers/croma-cps-in/

## Current status

- Flipkart adapter: implemented, but inactive until the two server-side credentials are configured.
- Amazon: not connected; Creators API prerequisites are not met merely by holding an Associates ID.
- Cuelinks: not a product-feed source.
- Admitad/Croma: possible feed source after program access and a real feed URL are confirmed.
- Myntra, AJIO, Croma direct, Tata CLiQ, and Amazon remain disconnected unless a verified provider feed/API is approved and integrated.

Do not use public-page scraping as a substitute for an authorised catalogue feed.
