# Librarai lookup Worker

Tiny Cloudflare Worker that resolves Israeli book SKUs (12-digit publisher
barcodes that aren't ISBNs) by web-searching the barcode, finding the first
Israeli bookstore product page, and extracting the title/author.

## One-time setup (5 minutes)

1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up) (free).
2. From this directory:

   ```bash
   npm install
   npx wrangler login   # opens a browser, links the CLI to your account
   npx wrangler deploy
   ```

3. Wrangler prints the deployed URL, e.g.
   `https://librarai-lookup.<your-subdomain>.workers.dev`.
4. Open the app, go to **Scan → Advanced**, paste the URL into
   *"Lookup Worker URL"*, hit Save.

That's it. Non-ISBN barcodes will now auto-resolve through the Worker.

## Cost

Free. Cloudflare Workers free tier is 100,000 requests/day; you'll use
roughly one request per scan.

## Endpoints

- `GET /lookup?barcode=009900026462`
  Returns `{ barcode, title, authors, publisher?, source, sourceUrl, thumbnail? }`
  or `{ barcode, matches: [...] }` if parsing fell short.
- `GET /` — health check.

## Updating

Edit `src/index.ts`, then `npx wrangler deploy`. No app rebuild needed.

## Local dev

```bash
npx wrangler dev
# then: curl 'http://localhost:8787/lookup?barcode=009900026462'
```
