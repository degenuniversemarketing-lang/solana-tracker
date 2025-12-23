const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

/* ================= CONFIG ================= */
// HTTP RPC URL (for tx details)
const RPC_HTTP_URL = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";

// WebSocket URL (for real-time notifications)
const RPC_WS_URL = "wss://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";

const connection = new Connection(RPC_HTTP_URL, "confirmed");
const wsConnection = new Connection(RPC_HTTP_URL, { commitment: "confirmed" }); // still need HTTP for tx parsing

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(',');
const WALLET = process.env.WALLET_ADDRESS;

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const LOGO_URL = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

const MIN_AMOUNT_SOL = 0.01;
const MIN_AMOUNT_USDT = 1;
const MIN_AMOUNT_USDC = 1;

/* ================= STATE ================= */
const processedSignatures = new Set();
const MAX_SIG_CACHE = 5000;
let priceCache = { SOL: 0, USDT: 1, USDC: 1, ts: 0 };
let isSending = false;

/* ================= PRICE FETCH ================= */
async function getPrices() {
  if (Date.now() - priceCache.ts < 60000) return priceCache; // cache 1 min

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol: "SOL,USDT,USDC", convert: "USD" }
      }
    );

    priceCache = {
      SOL: res.data.data.SOL.quote.USD.price,
      USDT: 1,
      USDC: 1,
      ts: Date.now()
    };
  } catch (err) {
    console.log("⚠️ Failed to fetch prices, using cached values");
  }

  return priceCache;
}

/* ================= ALERT FUNCTION ================= */
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
        parse_mode: "HTML"
      });
      await new Promise(r => setTimeout(r, 1200)); // THROTTLE
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  console.log(`✅ ${type} alert: ${amount}`);
  isSending = false;
}

/* ================= WEBSOCKET LISTENER ================= */
async function startWebSocket() {
  wsConnection.onLogs(new PublicKey(WALLET), async (logs, ctx) => {
    try {
      const sig = ctx.signature;
      if (processedSignatures.has(sig)) return;

      processedSignatures.add(sig);
      if (processedSignatures.size > MAX_SIG_CACHE)
        processedSignatures.delete(processedSignatures.values().next().value);

      const tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) return;

      // SOL INCOMING
      const solDiff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
      if (solDiff >= MIN_AMOUNT_SOL) await sendAlert("SOL", solDiff, sig);

      // TOKENS INCOMING
      const instructions = [
        ...(tx.transaction.message.instructions || []),
        ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)
      ];

      for (const ix of instructions) {
        if (ix.program !== "spl-token") continue;
        if (ix.parsed?.type !== "transfer") continue;
        if (ix.parsed.info.destination !== WALLET) continue;

        const mint = ix.parsed.info.mint;
        const amount = Number(ix.parsed.info.amount) / 1e6;

        if (mint === USDT_MINT && amount >= MIN_AMOUNT_USDT)
          await sendAlert("USDT", amount, sig);
        if (mint === USDC_MINT && amount >= MIN_AMOUNT_USDC)
          await sendAlert("USDC", amount, sig);
      }
    } catch (err) {
      console.log("⚠️ WebSocket scan error:", err.message);
    }
  });
}

/* ================= TEST COMMANDS ================= */
bot.onText(/\/test_sol/, msg => sendAlert("SOL", 0.05, "TEST_SOL"));
bot.onText(/\/test_usdt/, msg => sendAlert("USDT", 123.4567, "TEST_USDT"));
bot.onText(/\/test_usdc/, msg => sendAlert("USDC", 250.0, "TEST_USDC"));

/* ================= START ================= */
console.log("🚀 SOL + USDT + USDC Tracker Running (PER TX, CLEAN)");
startWebSocket();
