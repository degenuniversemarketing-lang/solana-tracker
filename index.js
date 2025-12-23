const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

/* ================= CONFIG ================= */

const RPC_URL = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(RPC_URL, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(',');
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const MIN_AMOUNT = 1;
const CHECK_INTERVAL = 15000;

const LOGO_URL = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= STATE ================= */

const processedTxs = new Set();
const MAX_CACHE = 1500;

let priceCache = {
  SOL: 0,
  USDT: 1,
  USDC: 1,
  time: 0
};

/* ================= PRICE (RATE SAFE) ================= */

async function getPricesUSD() {
  if (Date.now() - priceCache.time < 60000) return priceCache;

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
      time: Date.now()
    };
  } catch {}

  return priceCache;
}

/* ================= ALERT ================= */

async function sendAlert(type, amount, sig) {
  const prices = await getPricesUSD();
  const usd = (amount * prices[type]).toFixed(2);

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${type}</b> ( $${usd} )

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

  for (const id of CHAT_IDS) {
    try {
      await bot.sendPhoto(id, LOGO_URL, {
        caption,
        parse_mode: "HTML"
      });
    } catch {
      await bot.sendMessage(id, caption, { parse_mode: "HTML" });
    }
  }

  console.log(`✅ Alert sent: ${amount} ${type}`);
}

/* ================= SCAN ================= */

async function scan() {
  try {
    const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 10 });

    for (const s of sigs) {
      if (processedTxs.has(s.signature)) continue;

      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0
      });

      processedTxs.add(s.signature);
      if (processedTxs.size > MAX_CACHE)
        processedTxs.delete(processedTxs.values().next().value);

      if (!tx || !tx.meta) continue;

      /* ===== SOL ===== */
      const solDiff =
        (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;

      if (solDiff >= MIN_AMOUNT) {
        await sendAlert("SOL", solDiff, s.signature);
      }

      /* ===== TOKENS ===== */
      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      for (const p of post) {
        if (p.owner !== WALLET.toBase58()) continue;

        const before = pre.find(
          b => b.mint === p.mint && b.owner === p.owner
        );

        const diff =
          (p.uiTokenAmount.uiAmount || 0) -
          (before?.uiTokenAmount?.uiAmount || 0);

        if (diff < MIN_AMOUNT) continue;

        if (p.mint === USDT_MINT)
          await sendAlert("USDT", diff, s.signature);

        if (p.mint === USDC_MINT)
          await sendAlert("USDC", diff, s.signature);
      }
    }
  } catch {}
}

/* ================= LOOP ================= */

setInterval(scan, CHECK_INTERVAL);

/* ================= /TEST ================= */

bot.onText(/\/test/, async msg => {
  const id = msg.chat.id;
  await bot.sendPhoto(id, LOGO_URL, {
    caption: `
🚨 <b>New Buy Alert!</b>

💰 <b>123.4567 USDT</b> ( $123.46 )

🔗 <a href="https://solscan.io">View Transaction</a>
`.trim(),
    parse_mode: "HTML"
  });
});

/* ================= START ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (NO DUPLICATES)");