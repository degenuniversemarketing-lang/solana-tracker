const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC_URL =
  "https://ultra-sleek-friday.solana-mainnet.quiknode.pro/52dd5e4af8e55ddaff91cbcad5b5e72dfd7d5d2a/";

const connection = new Connection(RPC_URL, "confirmed");
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const CHECK_INTERVAL = 15_000;
const MIN_SOL = 0.01;
const MIN_TOKEN = 1;

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= TOKENS ================= */

const TOKENS = {
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

const priceCache = {};
const PRICE_TTL = 60_000;

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
      await bot.sendPhoto(chat, LOGO, { caption, parse_mode: "HTML" });
      await new Promise((r) => setTimeout(r, 1200));
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  sending = false;
  processQueue();
}

function enqueueAlert(amount, symbol, tx) {
  alertQueue.push({ amount, symbol, tx });
  processQueue();
}

/* ================= SCAN SOL ================= */

async function scanSOL() {
  const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 10 });
  for (const s of sigs) {
    if (seenTx.has(s.signature)) continue;

    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;

    const diff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
    if (diff >= MIN_SOL) {
      seenTx.add(s.signature);
      enqueueAlert(diff, "SOL", s.signature);
    }
  }
}

/* ================= SCAN TOKENS ================= */

async function scanToken(symbol, token) {
  const accounts = await connection.getParsedTokenAccountsByOwner(WALLET, { mint: token.mint });
  if (!accounts.value.length) return;

  const tokenAcc = new PublicKey(accounts.value[0].pubkey);
  const sigs = await connection.getSignaturesForAddress(tokenAcc, { limit: 10 });

  for (const s of sigs) {
    if (seenTx.has(s.signature)) continue;

    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)
    ];

    for (const ix of instructions) {
      if (
        ix.program === "spl-token" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.destination === tokenAcc.toString()
      ) {
        const amount = Number(ix.parsed.info.amount) / 10 ** token.decimals;
        if (amount >= MIN_TOKEN) {
          seenTx.add(s.signature);
          enqueueAlert(amount, symbol, s.signature);
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
    await scanToken("USDT", TOKENS.USDT);
    await scanToken("USDC", TOKENS.USDC);
  } catch (e) {
    console.log("Scan error:", e.message);
  }
  scanning = false;
}

console.log("🚀 SOL + USDT + USDC Tracker Running (HTTPS, USD enabled)");
setInterval(loop, CHECK_INTERVAL);

/* ================= TEST ================= */

bot.onText(/\/test_usdt/, () => enqueueAlert(123.4567, "USDT", "test_tx"));
bot.onText(/\/test_usdc/, () => enqueueAlert(250.0, "USDC", "test_tx"));
bot.onText(/\/test_sol/, () => enqueueAlert(5.4321, "SOL", "test_tx"));
