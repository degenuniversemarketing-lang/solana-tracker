const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC =
  "https://young-restless-market.solana-mainnet.quiknode.pro/bb6affad416ecf818dfa14848a919d242417c783/";

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
    decimals: 6
  },
  USDC: {
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6
  }
};

/* ================= STATE ================= */

const seenTx = new Set();
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
        parse_mode: "HTML"
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

/* ================= SOL SCAN ================= */

async function scanSOL() {
  // fetch last 50 signatures to avoid missing big txns
  const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 50 });

  for (const sig of sigs.reverse()) {
    if (seenTx.has(sig.signature)) continue;

    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0
    });
    if (!tx) continue;

    const pre = tx.meta?.preBalances[0] || 0;
    const post = tx.meta?.postBalances[0] || 0;
    const diff = (post - pre) / LAMPORTS_PER_SOL;

    if (diff >= MIN_SOL) {
      seenTx.add(sig.signature);
      enqueueAlert(diff, "SOL", sig.signature);
    }
  }
}

/* ================= TOKEN SCAN ================= */

async function scanToken(symbol, mint, decimals) {
  const accounts = await connection.getParsedTokenAccountsByOwner(WALLET, {
    mint
  });
  if (!accounts.value.length) return;

  const tokenAcc = new PublicKey(accounts.value[0].pubkey);
  const sigs = await connection.getSignaturesForAddress(tokenAcc, { limit: 50 });

  for (const sig of sigs.reverse()) {
    if (seenTx.has(sig.signature)) continue;

    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0
    });
    if (!tx) continue;

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions || []).flatMap((i) => i.instructions)
    ];

    for (const ix of instructions) {
      if (
        ix.program === "spl-token" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.destination === tokenAcc.toString()
      ) {
        const amount = Number(ix.parsed.info.amount) / Math.pow(10, decimals);

        if (amount >= MIN_TOKEN) {
          seenTx.add(sig.signature);
          enqueueAlert(amount, symbol, sig.signature);
          break;
        }
      }
    }
  }
}

/* ================= LOOP ================= */

async function loop() {
  if (scanning) return;
  scanning = true;

  try {
    await scanSOL();
    await scanToken("USDT", TOKENS.USDT.mint, TOKENS.USDT.decimals);
    await scanToken("USDC", TOKENS.USDC.mint, TOKENS.USDC.decimals);
  } catch (e) {
    console.log("Scan error:", e.message);
  }

  scanning = false;
}

console.log("🚀 SOL + USDT + USDC Tracker Running (All TXs, USD enabled)");
setInterval(loop, CHECK_INTERVAL);

/* ================= TEST ================= */

bot.onText(/\/test/, () => {
  enqueueAlert(500, "USDT", "test_tx");
});
