const fs = require("fs");
const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC =
  "https://ultra-sleek-friday.solana-mainnet.quiknode.pro/52dd5e4af8e55ddaff91cbcad5b5e72dfd7d5d2a/";

const connection = new Connection(RPC, "confirmed");
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const MIN_SOL = 0.01;
const MIN_TOKEN = 1;
const CHECK_INTERVAL = 5000;

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= TOKENS ================= */

const TOKENS = {
  USDT: {
    mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    decimals: 6,
  },
  USDC: {
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
  },
};

/* ================= STATE (PERSISTENT) ================= */

const STATE_FILE = "./state.json";
let lastSigMap = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : {};

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(lastSigMap, null, 2));
}

/* ================= PRICE CACHE ================= */

const priceCache = {};
async function getPrice(symbol) {
  if (priceCache[symbol] && Date.now() - priceCache[symbol].ts < 60000)
    return priceCache[symbol].price;

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" },
      }
    );

    const price = res.data.data[symbol].quote.USD.price;
    priceCache[symbol] = { price, ts: Date.now() };
    return price;
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERT ================= */

let sending = false;
async function sendAlert(amount, symbol, sig) {
  if (sending) return;
  sending = true;

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
      await new Promise(r => setTimeout(r, 1200));
    } catch {
      await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
    }
  }

  sending = false;
}

/* ================= HELPERS ================= */

async function getATA(mint) {
  const accs = await connection.getParsedTokenAccountsByOwner(WALLET, { mint });
  return accs.value[0]?.pubkey || null;
}

/* ================= SCANNERS ================= */

async function scanSOL() {
  const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 5 });
  if (!lastSigMap.SOL) {
    lastSigMap.SOL = sigs[0]?.signature || null;
    saveState();
    return;
  }

  for (const s of sigs.reverse()) {
    if (s.signature === lastSigMap.SOL) continue;
    lastSigMap.SOL = s.signature;
    saveState();

    const tx = await connection.getParsedTransaction(s.signature);
    if (!tx?.meta) continue;

    const diff =
      (tx.meta.postBalances[0] - tx.meta.preBalances[0]) /
      LAMPORTS_PER_SOL;

    if (diff >= MIN_SOL) {
      await sendAlert(diff, "SOL", s.signature);
    }
  }
}

async function scanToken(symbol) {
  const token = TOKENS[symbol];
  const ata = await getATA(token.mint);
  if (!ata) return;

  const key = ata.toString();
  const sigs = await connection.getSignaturesForAddress(ata, { limit: 5 });

  if (!lastSigMap[key]) {
    lastSigMap[key] = sigs[0]?.signature || null;
    saveState();
    return;
  }

  for (const s of sigs.reverse()) {
    if (s.signature === lastSigMap[key]) continue;
    lastSigMap[key] = s.signature;
    saveState();

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
        const amount =
          Number(ix.parsed.info.amount) / 10 ** token.decimals;

        if (amount >= MIN_TOKEN) {
          await sendAlert(amount, symbol, s.signature);
        }
        break;
      }
    }
  }
}

/* ================= LOOP ================= */

async function loop() {
  try {
    await scanSOL();
    await scanToken("USDT");
    await scanToken("USDC");
  } catch {}
}

setInterval(loop, CHECK_INTERVAL);

/* ================= TEST COMMANDS ================= */

bot.onText(/\/test_sol/, () =>
  sendAlert(1.2345, "SOL", "TEST_SOL")
);
bot.onText(/\/test_usdt/, () =>
  sendAlert(500, "USDT", "TEST_USDT")
);
bot.onText(/\/test_usdc/, () =>
  sendAlert(1000, "USDC", "TEST_USDC")
);

/* ================= START ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (FINAL, NO DUPES)");