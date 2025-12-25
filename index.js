const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

// ===== CONFIG =====
const HAPI = process.env.HELIUS_KEY;
const RPC = `https://rpc.helius.xyz/?api-key=${HAPI}`;
const connection = new Connection(RPC, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);
const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL || 3000);
const MIN_SOL = Number(process.env.MIN_ALERT_SOL || 0.01);
const MIN_TOKEN = Number(process.env.MIN_ALERT_TOKEN || 1);

const LOGO = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = process.env.CMC_API_KEY;

// ===== STATE =====
let state = { lastSigs: {} };
try {
  state = JSON.parse(fs.readFileSync("./state.json"));
} catch {}
function saveState() {
  fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
}

// ===== TOKENS =====
const TOKENS = {
  SOL: { symbol: "SOL" },
  USDT: { symbol: "USDT", mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), decimals: 6 },
  USDC: { symbol: "USDC", mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6 }
};

// ===== PRICE CACHE =====
const priceCache = {};
const PRICE_TTL = 60000;
async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].time < PRICE_TTL) return priceCache[symbol].price;

  try {
    const res = await axios.get("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest", {
      headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
      params: { symbol, convert: "USD" }
    });
    const price = res.data.data[symbol].quote.USD.price;
    priceCache[symbol] = { price, time: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

// ===== ALERT QUEUE =====
const alertQueue = [];
let sending = false;
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
      await new Promise(r => setTimeout(r, 1200));
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

// ===== UTILS =====
async function getATA(mint) {
  const accounts = await connection.getTokenAccountsByOwner(WALLET, { mint });
  return accounts.value[0]?.pubkey || null;
}

// ===== SCAN FUNCTION =====
async function scanAccount(account, symbol, decimals = 6) {
  const sigs = await connection.getSignaturesForAddress(account, { limit: 10 });
  const lastSig = state.lastSigs[account.toString()] || null;
  let newSigs = sigs;
  if (lastSig) {
    const index = sigs.findIndex(s => s.signature === lastSig);
    newSigs = index === -1 ? sigs : sigs.slice(0, index);
  }

  for (const s of newSigs.reverse()) {
    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;

    if (symbol === "SOL") {
      const diff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
      if (diff >= MIN_SOL) enqueueAlert(diff, "SOL", s.signature);
    } else {
      const instructions = [
        ...tx.transaction.message.instructions,
        ...(tx.meta?.innerInstructions || []).flatMap(i => i.instructions)
      ];
      for (const ix of instructions) {
        if (ix.program === "spl-token" && ix.parsed?.type === "transfer" && ix.parsed.info.destination === account.toString()) {
          const amount = Number(ix.parsed.info.amount) / Math.pow(10, decimals);
          if (amount >= MIN_TOKEN) enqueueAlert(amount, symbol, s.signature);
        }
      }
    }

    state.lastSigs[account.toString()] = s.signature;
    saveState();
  }
}

// ===== MAIN LOOP =====
async function loop() {
  try {
    await scanAccount(WALLET, "SOL");

    const usdtATA = await getATA(TOKENS.USDT.mint);
    const usdcATA = await getATA(TOKENS.USDC.mint);

    if (usdtATA) await scanAccount(usdtATA, "USDT", TOKENS.USDT.decimals);
    if (usdcATA) await scanAccount(usdcATA, "USDC", TOKENS.USDC.decimals);
  } catch (e) {
    console.log("Scan error:", e.message);
  }
}

console.log("🚀 SOL + USDT + USDC Tracker Running (Helius HTTPS, real-time, USD enabled)");
setInterval(loop, CHECK_INTERVAL);

// ===== TEST =====
bot.onText(/\/test_sol/, () => enqueueAlert(5.4321, "SOL", "TEST_SOL"));
bot.onText(/\/test_usdt/, () => enqueueAlert(123.4567, "USDT", "TEST_USDT"));
bot.onText(/\/test_usdc/, () => enqueueAlert(250.0, "USDC", "TEST_USDC"));