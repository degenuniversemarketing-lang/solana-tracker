const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

/* ================= CONFIG ================= */
const RPC =
  "https://ultra-sleek-friday.solana-mainnet.quiknode.pro/52dd5e4af8e55ddaff91cbcad5b5e72dfd7d5d2a/";

const connection = new Connection(RPC, "confirmed");
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL || 5000);
const MIN_SOL = Number(process.env.MIN_ALERT_SOL || 0.01);
const MIN_TOKEN = Number(process.env.MIN_ALERT_TOKEN || 1);

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= TOKENS ================= */
const TOKENS = {
  SOL: { symbol: "SOL" },
  USDT: { symbol: "USDT", mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), decimals: 6 },
  USDC: { symbol: "USDC", mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6 },
};

/* ================= STATE ================= */
const stateFile = path.join(__dirname, "state.json");
let state = { lastSigs: { SOL: null, USDT: null, USDC: null } };
if (fs.existsSync(stateFile)) {
  state = JSON.parse(fs.readFileSync(stateFile));
}
function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/* ================= PRICE CACHE ================= */
const priceCache = {};
const PRICE_TTL = 60_000;
async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].time < PRICE_TTL)
    return priceCache[symbol].price;
  try {
    const res = await axios.get("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest", {
      headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
      params: { symbol, convert: "USD" }
    });
    const price = res.data.data[symbol]?.quote?.USD?.price || (symbol === "SOL" ? 0 : 1);
    priceCache[symbol] = { price, time: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERT ================= */
let sending = false;
async function sendAlert(amount, symbol, tx) {
  if (sending) return;
  sending = true;

  const price = await getPrice(symbol);
  const usd = (amount * price).toFixed(2);

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>
💵 <b>$${usd} USD</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO, { caption, parse_mode: "HTML" });
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  sending = false;
}

/* ================= SOL SCAN ================= */
async function scanSOL() {
  const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 5 });
  if (!sigs.length) return;

  if (!state.lastSigs.SOL) {
    state.lastSigs.SOL = sigs[0].signature;
    saveState();
    return;
  }

  for (const s of sigs.reverse()) {
    if (s.signature === state.lastSigs.SOL) continue;

    const tx = await connection.getParsedTransaction(s.signature);
    if (!tx || !tx.meta) continue;

    const diff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
    if (diff >= MIN_SOL) await sendAlert(diff, "SOL", s.signature);

    state.lastSigs.SOL = s.signature;
    saveState();
  }
}

/* ================= TOKEN SCAN ================= */
async function scanToken(symbol, mint, decimals) {
  const accounts = await connection.getParsedTokenAccountsByOwner(WALLET, { mint });
  if (!accounts.value.length) return;

  const tokenAcc = accounts.value[0].pubkey;
  const sigs = await connection.getSignaturesForAddress(tokenAcc, { limit: 5 });

  if (!sigs.length) return;
  if (!state.lastSigs[symbol]) {
    state.lastSigs[symbol] = sigs[0].signature;
    saveState();
    return;
  }

  for (const s of sigs.reverse()) {
    if (s.signature === state.lastSigs[symbol]) continue;

    const tx = await connection.getParsedTransaction(s.signature);
    if (!tx || !tx.meta) continue;

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)
    ];

    for (const ix of instructions) {
      if (
        ix.program === "spl-token" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.destination === tokenAcc
      ) {
        const amount = Number(ix.parsed.info.amount) / Math.pow(10, decimals);
        if (amount >= MIN_TOKEN) await sendAlert(amount, symbol, s.signature);
        break;
      }
    }

    state.lastSigs[symbol] = s.signature;
    saveState();
  }
}

/* ================= LOOP ================= */
async function loop() {
  try {
    await scanSOL();
    await scanToken("USDT", TOKENS.USDT.mint, TOKENS.USDT.decimals);
    await scanToken("USDC", TOKENS.USDC.mint, TOKENS.USDC.decimals);
  } catch (e) {
    console.log("Scan error:", e.message);
  }
}
console.log("🚀 SOL + USDT + USDC Tracker Running (No duplicates, real-time)");
setInterval(loop, CHECK_INTERVAL);

/* ================= TEST COMMAND ================= */
bot.onText(/\/test_sol/, () => sendAlert(0.1234, "SOL", "TEST_SOL"));
bot.onText(/\/test_usdt/, () => sendAlert(10.1234, "USDT", "TEST_USDT"));
bot.onText(/\/test_usdc/, () => sendAlert(25.4321, "USDC", "TEST_USDC"));