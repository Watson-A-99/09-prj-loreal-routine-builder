# Project 9: L'Oréal Routine Builder
L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder. 

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## Public deployment with Cloudflare Worker

If you want to make the site public without exposing your Mistral API key in the browser, put the key in a Cloudflare Worker and point the site at that worker URL.

1. Create a worker project with Wrangler.
2. Replace the worker code with the example in [cloudflare-worker.js](cloudflare-worker.js).
3. Store your key as a secret:

```bash
wrangler secret put MISTRAL_API_KEY
```

4. Deploy the worker:

```bash
wrangler deploy
```

5. Copy the deployed worker URL into [config.js](config.js) by setting `window.CLOUDFLARE_WORKER_URL = "https://your-worker.your-subdomain.workers.dev";`.

For local testing, keep `secrets.js` in your workspace with `window.MISTRAL_API_KEY = "PASTE_YOUR_MISTRAL_API_KEY_HERE";` and leave the worker URL unset.