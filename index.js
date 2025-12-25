require("dotenv").config();
const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

/* ================= CONFIG ================= */

const RPC =
  "https://ultra-sleek-friday.solana-mainnet.quiknode.pro/52dd5e4af8e55ddaff91cbcad5b5e72dfd7d5d2a/";

const connection = new Connection(RPC, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const USDT_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const MIN_USDT = 1;
const MIN_USDC = 1;

const CHECK_INTERVAL = 2000;

/* ================= CMC ================= */

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";
let priceCache = { USDT: 1, USDC: 1, ts: 0 };

/* ================= STATE ================= */

// last processed signature PER ACCOUNT
const lastSigMap = {};
let initialized = false;
let scanning = false;

/* ================= PRICE ================= */

async function getPrice(symbol) {
  if (Date.now() - priceCache.ts < 60000) return priceCache[symbol];

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" },
      }
    );

    priceCache = {
      USDT: res.data.data.USDT.quote.USD.price,
      USDC: res.data.data.USDC.quote.USD.price,
      ts: Date.now(),
    };
  } catch {}

  return priceCache[symbol];
}

/* ================= TELEGRAM ================= */

async function sendAlert(amount, symbol, sig) {
  const price = await getPrice(symbol);
  const usd = (amount * price).toFixed(2);

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>
💵 <b>$${usd} USD</b>

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO, {
        caption,
        parse_mode: "HTML",
      });
      await new Promise(r => setTimeout(r, 1200)); // TG rate limit
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }
}

/* ================= TOKEN HELPERS ================= */

async function getATA(mint) {
  const res = await connection.getTokenAccountsByOwner(WALLET, { mint });
  return res.value[0]?.pubkey || null;
}

/* ================= CORE SCAN ================= */

async function scanToken(account, symbol, minAmount) {
  const key = account.toString();

  const sigs = await connection.getSignaturesForAddress(account, {
    limit: 10,
  });

  // On first run → mark latest sig ONLY (no old alerts)
  if (!initialized) {
    lastSigMap[key] = sigs[0]?.signature || null;
    return;
  }

  for (const s of sigs.reverse()) {
    if (s.signature === lastSigMap[key]) continue;
    lastSigMap[key] = s.signature;

    const tx = await connection.getParsedTransaction(s.signature);
    if (!tx?.meta) continue;

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions),
    ];

    for (const ix of instructions) {
      if (
        ix.program === "spl-token" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.destination === key
      ) {
        const amount = Number(ix.parsed.info.amount) / 1e6;

        if (amount >= minAmount) {
          await sendAlert(amount, symbol, s.signature);
        }
        break;
      }
    }
  }
}

/* ================= LOOP ================= */

async function loop() {
  if (scanning) return;
  scanning = true;

  try {
    const usdtATA = await getATA(USDT_MINT);
    const usdcATA = await getATA(USDC_MINT);

    if (usdtATA) await scanToken(usdtATA, "USDT", MIN_USDT);
    if (usdcATA) await scanToken(usdcATA, "USDC", MIN_USDC);

    initialized = true;
  } catch (e) {
    console.log("Scan error:", e.message);
  }

  scanning = false;
}

console.log("🚀 SOL + USDT + USDC Tracker Running (FINAL STABLE)");
setInterval(loop, CHECK_INTERVAL);

/* ================= TEST ================= */

bot.onText(/\/test/, () => {
  sendAlert(1234.56, "USDT", "TEST_TX");
});