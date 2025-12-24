const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC =
  "https://ultra-sleek-friday.solana-mainnet.quiknode.pro/52dd5e4af8e55ddaff91cbcad5b5e72dfd7d5d2a/";
const connection = new Connection(RPC, "confirmed");
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL || 15000);
const MIN_SOL = Number(process.env.MIN_ALERT_SOL || 0.01);
const MIN_TOKEN = Number(process.env.MIN_ALERT_TOKEN || 1);

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

/* ================= CMC ================= */

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";
const priceCache = {};
const PRICE_TTL = 60_000;

/* ================= TOKENS ================= */

const TOKENS = {
  SOL: { symbol: "SOL" },
  USDT: {
    mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    decimals: 6,
  },
  USDC: {
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
  },
};

/* ================= STATE ================= */

let lastSlot = 0; // track last processed slot
const alertQueue = [];
let sending = false;
let scanning = false;

/* ================= PRICE ================= */

async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].time < PRICE_TTL)
    return priceCache[symbol].price;

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" },
      }
    );
    const price = res.data.data[symbol].quote.USD.price;
    priceCache[symbol] = { price, time: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERT QUEUE ================= */

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
      await bot.sendPhoto(chat, LOGO, {
        caption,
        parse_mode: "HTML",
      });
      await new Promise((r) => setTimeout(r, 1200)); // HARD RATE LIMIT
    } catch (e) {
      console.log("Telegram error:", e.message);
    }
  }

  sending = false;
  processQueue();
}

function enqueueAlert(amount, symbol, tx) {
  alertQueue.push({ amount, symbol, tx });
  processQueue();
}

/* ================= SCAN ================= */

async function scan() {
  if (scanning) return;
  scanning = true;

  try {
    const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 10 });
    for (const sig of sigs.reverse()) {
      if (sig.slot <= lastSlot) continue;
      lastSlot = Math.max(lastSlot, sig.slot);

      const tx = await connection.getParsedTransaction(sig.signature);
      if (!tx) continue;

      // SOL
      const pre = tx.meta?.preBalances[0] || 0;
      const post = tx.meta?.postBalances[0] || 0;
      const solDiff = (post - pre) / LAMPORTS_PER_SOL;
      if (solDiff >= MIN_SOL) enqueueAlert(solDiff, "SOL", sig.signature);

      // TOKENS
      const instructions = [
        ...tx.transaction.message.instructions,
        ...(tx.meta?.innerInstructions || []).flatMap((i) => i.instructions),
      ];
      for (const ix of instructions) {
        if (
          ix.program === "spl-token" &&
          ix.parsed?.type === "transfer" &&
          ix.parsed.info.destination === WALLET.toString()
        ) {
          const amount = Number(ix.parsed.info.amount) / 10 ** 6;
          const symbol =
            ix.parsed.info.mint === TOKENS.USDT.mint.toString() ? "USDT" : "USDC";
          if (amount >= MIN_TOKEN) enqueueAlert(amount, symbol, sig.signature);
        }
      }
    }
  } catch (e) {
    console.log("Scan error:", e.message);
  }

  scanning = false;
}

/* ================= LOOP ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (HTTPS Polling, USD enabled)");
setInterval(scan, CHECK_INTERVAL);

/* ================= TEST COMMAND ================= */

bot.onText(/\/test_sol/, () => enqueueAlert(5, "SOL", "TEST_SOL"));
bot.onText(/\/test_usdt/, () => enqueueAlert(123.45, "USDT", "TEST_USDT"));
bot.onText(/\/test_usdc/, () => enqueueAlert(250, "USDC", "TEST_USDC"));