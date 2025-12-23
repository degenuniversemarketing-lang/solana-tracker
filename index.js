const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC_URL = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(RPC_URL, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CHECK_INTERVAL = 8000;
const MIN_AMOUNT = 1;

const LOGO_URL = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= STATE ================= */

const seen = new Set();
let lastSignature = null;
let priceCache = { SOL: 0, ts: 0 };

/* ================= PRICE ================= */

async function getSOLPrice() {
  if (Date.now() - priceCache.ts < 60000) return priceCache.SOL;

  try {
    const r = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol: "SOL", convert: "USD" }
      }
    );

    priceCache = {
      SOL: r.data.data.SOL.quote.USD.price,
      ts: Date.now()
    };
  } catch {}

  return priceCache.SOL || 0;
}

/* ================= ALERT ================= */

async function sendAlert(symbol, amount, sig) {
  const solPrice = symbol === "SOL" ? await getSOLPrice() : 1;
  const usd = (amount * solPrice).toFixed(2);

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b> ( $${usd} )

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO_URL, { caption, parse_mode: "HTML" });
      await new Promise(r => setTimeout(r, 1200));
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  console.log(`✅ ${symbol} alert: ${amount}`);
}

/* ================= SCAN ================= */

async function scan() {
  try {
    const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 5 });
    if (!sigs.length) return;

    for (const s of sigs.reverse()) {
      if (seen.has(s.signature)) continue;
      seen.add(s.signature);

      if (seen.size > 2000)
        seen.delete(seen.values().next().value);

      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx || !tx.meta) continue;

      /* SOL */
      const idx = tx.transaction.message.accountKeys.findIndex(
        a => a.pubkey.equals(WALLET)
      );

      if (idx !== -1) {
        const diff =
          (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) /
          LAMPORTS_PER_SOL;

        if (diff >= MIN_AMOUNT)
          await sendAlert("SOL", diff, s.signature);
      }

      /* TOKENS */
      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      for (const p of post) {
        const prev = pre.find(
          x =>
            x.accountIndex === p.accountIndex &&
            x.mint === p.mint
        );

        const diff =
          (p.uiTokenAmount.uiAmount || 0) -
          (prev?.uiTokenAmount.uiAmount || 0);

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

/* ================= TEST ================= */

bot.onText(/\/test_sol/, () =>
  sendAlert("SOL", 2.3456, "TEST_SOL")
);

bot.onText(/\/test_usdt/, () =>
  sendAlert("USDT", 150, "TEST_USDT")
);

bot.onText(/\/test_usdc/, () =>
  sendAlert("USDC", 250, "TEST_USDC")
);

/* ================= START ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (CLEAN)");
