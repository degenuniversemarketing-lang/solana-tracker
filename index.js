const { PublicKey } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const WebSocket = require("ws");
require("dotenv").config();

/* ================= CONFIG ================= */

const HELIUS_WS = "wss://mainnet.helius-rpc.com/?api-key=dd897fbc-4cfc-4af9-bded-e7fe74f4450b";
const WALLET = process.env.WALLET_ADDRESS;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(",");

const MIN_SOL = Number(process.env.MIN_ALERT_SOL || 1); // 1 SOL min
const MIN_TOKEN = Number(process.env.MIN_ALERT_TOKEN || 1); // 1 USDT/USDC min
const LOGO = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";
const priceCache = {};
const PRICE_TTL = 60_000;

/* ================= TOKENS ================= */

const TOKENS = {
  SOL: { symbol: "SOL" },
  USDT: { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 }
};

/* ================= STATE ================= */

const seenTx = new Set();
const alertQueue = [];
let sending = false;

/* ================= PRICE FETCH ================= */

async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].time < PRICE_TTL) {
    return priceCache[symbol].price;
  }

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" }
      }
    );
    const price = res.data.data[symbol].quote.USD.price;
    priceCache[symbol] = { price, time: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERTS ================= */

async function processQueue() {
  if (sending || alertQueue.length === 0) return;
  sending = true;

  const job = alertQueue.shift();
  const price = await getPrice(job.symbol);
  const usd = job.amount * price;

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${job.amount.toFixed(4)} ${job.symbol}</b>
💵 <b>$${usd.toFixed(2)} USD</b>

🔗 <a href="https://solscan.io/tx/${job.tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO, { caption, parse_mode: "HTML" });
      await new Promise(r => setTimeout(r, 1200)); // avoid Telegram rate limit
    } catch (e) {
      console.log("Telegram error:", e.message);
    }
  }

  sending = false;
  processQueue();
}

function enqueueAlert(amount, symbol, tx) {
  if (!seenTx.has(tx)) {
    seenTx.add(tx);
    alertQueue.push({ amount, symbol, tx });
    processQueue();
  }
}

/* ================= HELIUS WS ================= */

function initWS() {
  const ws = new WebSocket(HELIUS_WS);

  ws.on("open", () => {
    console.log("🔵 Helius WebSocket connected");

    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscribe",
      params: {
        type: "wallet",
        address: WALLET,
        commitment: "confirmed",
        includeTransactions: true
      }
    }));
  });

  ws.on("message", async (data) => {
    const msg = JSON.parse(data);

    if (msg.method === "notification" && msg.params?.result?.type === "transaction") {
      const tx = msg.params.result.signature;
      const instructions = msg.params.result.transaction.message.instructions;

      for (const ix of instructions) {
        if (ix.program === "system" && ix.parsed?.type === "transfer") {
          const solAmount = ix.parsed.info.lamports / 1e9;
          if (solAmount >= MIN_SOL) enqueueAlert(solAmount, "SOL", tx);
        }

        if (ix.program === "spl-token" && ix.parsed?.type === "transfer") {
          const mint = ix.parsed.info.mint;
          const amount = Number(ix.parsed.info.amount);

          if (mint === TOKENS.USDT.mint && amount / 1e6 >= MIN_TOKEN) {
            enqueueAlert(amount / 1e6, "USDT", tx);
          }
          if (mint === TOKENS.USDC.mint && amount / 1e6 >= MIN_TOKEN) {
            enqueueAlert(amount / 1e6, "USDC", tx);
          }
        }
      }
    }
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed, reconnecting in 5s...");
    setTimeout(initWS, 5000);
  });

  ws.on("error", (err) => {
    console.log("WebSocket error:", err.message);
    ws.close();
  });
}

/* ================= INIT ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (Helius WS, NO DUPES)");
initWS();

/* ================= TEST COMMAND ================= */

bot.onText(/\/test/, () => {
  enqueueAlert(500, "USDT", "test_tx");
});