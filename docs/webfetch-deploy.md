# Webfetch (Jina Reader) — Activation

`server/services/webfetch.js` routes scrapes through [Jina Reader](https://jina.ai/reader/), a free public service that returns clean HTML for any URL. Zero local infrastructure — no docker, no extra RAM on your Hetzner box.

## Activate

In your `.env` on the server:

```
USE_WEBFETCH=true
# Optional: get a free key at jina.ai/reader → higher rate limits
JINA_API_KEY=jina_xxxxxxxx
```

Restart verba (`pm2 restart verba` or whatever you use). Done.

## Rollback

```
USE_WEBFETCH=false
```

Restart. You're back to the original axios+cheerio scraper instantly.

## Rate limits

- **No key:** ~20 RPM, free forever.
- **Free key (jina.ai signup):** higher limits, still free.
- **Paid:** only needed at very high volume.

For card cutting, the free tier is almost certainly enough.

## What this does NOT change

- The cheerio extraction in `scraper.js` runs identically — paragraph anchors, JSON-LD metadata, figure handling, all preserved. Only the HTML *fetch* changes.
- PDF scraping (`scrapePdf`) still uses axios + pdf-parse. Jina is HTML-only.
- API adapters in `services/sources/*` and `services/cite/*` are untouched.
