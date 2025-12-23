const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(RPC, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const LOGO_URL = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = process.env.CMC_API_KEY;

const CHECK_INTERVAL = 15000;
const MIN_AMOUNT = 1;

let lastSignature = null;
let priceCache = {};

/* ================= PRICE (CACHED) ================= */

async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].time < 120000)
    return priceCache[symbol].price;

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" },
        timeout: 8000
      }
    );

    const price = res.data.data[symbol].quote.USD.price;
    priceCache[symbol] = { price, time: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERT ================= */

async function sendAlert(token, amount, tx) {
  const price = await getPrice(token);
  const usd = (amount * price).toFixed(2);

  const msg = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${token}</b>
💵 <b>$${usd}</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const id of CHAT_IDS) {
    await bot.sendPhoto(id, LOGO_URL, {
      caption: msg,
      parse_mode: "HTML"
    });
  }

  console.log(`✅ Alert sent: ${amount} ${token}`);
}

/* ================= TX SCAN ================= */

async function scanIncoming() {
  try {
    const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 5 });

    for (const s of sigs) {
      if (s.signature === lastSignature) break;

      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0
      });

      if (!tx?.meta) continue;

      /* -------- SOL -------- */
      const pre = tx.meta.preBalances[0];
      const post = tx.meta.postBalances[0];
      const solDiff = (post - pre) / LAMPORTS_PER_SOL;

      if (solDiff >= MIN_AMOUNT) {
        await sendAlert("SOL", solDiff, s.signature);
      }

      /* -------- TOKENS -------- */
      const changes = tx.meta.postTokenBalances || [];
      for (const c of changes) {
        if (c.owner !== WALLET.toBase58()) continue;

        const mint = c.mint;
        const amount = c.uiTokenAmount.uiAmount || 0;

        if (amount < MIN_AMOUNT) continue;

        if (mint === USDT_MINT) {
          await sendAlert("USDT", amount, s.signature);
        }

        if (mint === USDC_MINT) {
          await sendAlert("USDC", amount, s.signature);
        }
      }
    }

    lastSignature = sigs[0]?.signature || lastSignature;
  } catch {
    // SILENT — no spam, no crash
  }
}

/* ================= TEST COMMAND ================= */

bot.onText(/\/test/, async (msg) => {
  await sendAlert("USDT", 123.45, "test_tx_hash");
});

/* ================= START ================= */

console.log("🚀 Incoming SOL + USDT + USDC Tracker Running");

setInterval(scanIncoming, CHECK_INTERVAL);
