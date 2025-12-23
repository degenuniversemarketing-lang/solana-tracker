const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */
const HTTP_RPC_URL =
  "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(HTTP_RPC_URL, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = process.env.WALLET_ADDRESS;

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CHECK_INTERVAL = 15000; // 15s
const MIN_SOL = 0.01;
const MIN_USDT = 1;
const MIN_USDC = 1;

const LOGO_URL =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= STATE ================= */
const processedSignatures = new Set();
const MAX_SIG_CACHE = 5000;
let priceCache = { SOL: 0, USDT: 1, USDC: 1, ts: 0 };
let isSending = false;

/* ================= PRICE FETCH ================= */
async function getPrices() {
  if (Date.now() - priceCache.ts < 60000) return priceCache;

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol: "SOL,USDT,USDC", convert: "USD" },
      }
    );
    priceCache = {
      SOL: res.data.data.SOL.quote.USD.price,
      USDT: 1,
      USDC: 1,
      ts: Date.now(),
    };
  } catch (err) {
    console.log("⚠️ CMC price fetch failed, using cached/fallback price");
  }
  return priceCache;
}

/* ================= ALERT SENDER ================= */
async function sendAlert(type, amount, sig) {
  if (isSending) return;
  isSending = true;

  const prices = await getPrices();
  const usd = (amount * prices[type]).toFixed(2);

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${type}</b> ( $${usd} )

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO_URL, {
        caption,
        parse_mode: "HTML",
      });
      await new Promise((r) => setTimeout(r, 1000)); // throttle 1s per chat
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  console.log(`✅ ${type} alert: ${amount}`);
  isSending = false;
}

/* ================= TX SCANNER ================= */
async function scan() {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(WALLET),
      { limit: 20 }
    );

    for (const s of sigs) {
      if (processedSignatures.has(s.signature)) continue;
      processedSignatures.add(s.signature);
      if (processedSignatures.size > MAX_SIG_CACHE)
        processedSignatures.delete(processedSignatures.values().next().value);

      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta) continue;

      /* SOL INCOMING */
      const solDiff =
        (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
      if (solDiff >= MIN_SOL) await sendAlert("SOL", solDiff, s.signature);

      /* TOKENS INCOMING */
      const instructions = [
        ...(tx.transaction.message.instructions || []),
        ...(tx.meta.innerInstructions || []).flatMap((i) => i.instructions),
      ];

      for (const ix of instructions) {
        if (ix.program !== "spl-token") continue;
        if (ix.parsed?.type !== "transfer") continue;
        if (ix.parsed.info.destination !== WALLET) continue;

        const mint = ix.parsed.info.mint;
        const amount = Number(ix.parsed.info.amount) / 1e6;
        if (mint === USDT_MINT && amount >= MIN_USDT)
          await sendAlert("USDT", amount, s.signature);
        if (mint === USDC_MINT && amount >= MIN_USDC)
          await sendAlert("USDC", amount, s.signature);
      }
    }
  } catch (err) {
    console.log("Scan error:", err.message || err);
  }
}

/* ================= LOOP ================= */
setInterval(scan, CHECK_INTERVAL);

/* ================= TEST COMMANDS ================= */
bot.onText(/\/test_sol/, (msg) =>
  sendAlert("SOL", 0.1234, "TEST_SOL")
);
bot.onText(/\/test_usdt/, (msg) =>
  sendAlert("USDT", 50.1234, "TEST_USDT")
);
bot.onText(/\/test_usdc/, (msg) =>
  sendAlert("USDC", 100.5678, "TEST_USDC")
);

/* ================= START ================= */
console.log("🚀 SOL + USDT + USDC Tracker Running (REAL-TIME, USD enabled)");