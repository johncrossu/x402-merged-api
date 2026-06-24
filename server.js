const express = require("express");
const { createPublicClient, http, formatEther } = require("viem");
const { base } = require("viem/chains");

const app = express();
const PORT = process.env.PORT || 3000;
const PAYTO_ADDRESS = process.env.PAYTO_ADDRESS || "0xa1ee7650d9214b4913fb775e9093491e56369f82";
const FACILITATOR_URL = "https://x402.org/facilitator";
const NETWORK = "eip155:8453";

const rpcClient = createPublicClient({ chain: base, transport: http() });

function requirePayment(price, description) {
  return async (req, res, next) => {
    const paymentHeader = req.headers["x-payment"];
    if (!paymentHeader) {
      return res.status(402).json({
        x402Version: 1,
        accepts: [{ scheme: "exact", network: NETWORK, maxAmountRequired: price, resource: req.originalUrl, description, payTo: PAYTO_ADDRESS, asset: "USDC", brand: "johncross.base.eth / J-sey Enterprises" }],
      });
    }
    try {
      const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentHeader, paymentRequirements: { scheme: "exact", network: NETWORK, payTo: PAYTO_ADDRESS, maxAmountRequired: price } }),
      });
      const verification = await verifyRes.json();
      if (!verification.isValid) return res.status(402).json({ error: "Payment verification failed" });
      await fetch(`${FACILITATOR_URL}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentHeader }) });
      next();
    } catch (err) {
      res.status(500).json({ error: "Payment processing error", details: String(err) });
    }
  };
}

app.get("/wallet-info", requirePayment("$0.002", "Base wallet balance + tx count"), async (req, res) => {
  const address = req.query.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: "Provide a valid ?address=0x..." });
  try {
    const [balanceWei, txCount] = await Promise.all([rpcClient.getBalance({ address }), rpcClient.getTransactionCount({ address })]);
    res.json({ address, network: "base", balanceETH: formatEther(balanceWei), transactionCount: txCount });
  } catch (err) { res.status(500).json({ error: "Failed to fetch wallet info", details: String(err) }); }
});

function stripHtml(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

app.get("/scrape", requirePayment("$0.002", "Clean text scrape of a webpage"), async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "Provide a valid ?url=https://..." });
  try {
    const pageRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; x402-scrape-bot/1.0)" } });
    const html = await pageRes.text();
    const cleanText = stripHtml(html).slice(0, 5000);
    res.json({ url, contentLength: cleanText.length, text: cleanText });
  } catch (err) { res.status(500).json({ error: "Failed to scrape page", details: String(err) }); }
});

app.get("/token-price", requirePayment("$0.002", "Live token price in USD"), async (req, res) => {
  const symbol = (req.query.symbol || "").toLowerCase();
  if (!symbol) return res.status(400).json({ error: "Provide a ?symbol=bitcoin" });
  try {
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`);
    const data = await cgRes.json();
    if (!data[symbol]) return res.status(404).json({ error: `No price found for '${symbol}'` });
    res.json({ symbol, priceUSD: data[symbol].usd, fetchedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: "Failed to fetch price", details: String(err) }); }
});

app.get("/", (req, res) => res.json({ business: "J-sey Enterprises", brand: "johncross.base.eth", status: "running", endpoints: ["/wallet-info", "/scrape", "/token-price"] }));

app.listen(PORT, () => console.log(`x402 API live on port ${PORT}`));
