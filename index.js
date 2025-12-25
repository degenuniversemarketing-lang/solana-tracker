const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
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
const POLL_INTERVAL = 2000; // 🔥 2 sec = near realtime

const LOGO =
  "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

/* ================= TOKENS ================= */

const TOKENS = {
  USDT: {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
};

/* ================= CMC ================= */

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";
let cachedPrices = {};
let lastPriceFetch = 0;

/* ================= STATE ================= */

// 🔥 THIS IS THE FIX
let lastProcessedSignature = null;
let initialized = false;

/* ================= PRICE ================= */

async function getPrice(symbol) {
  if (Date.now() - lastPriceFetch < 60000 && cachedPrices[symbol])
    return cachedPrices[symbol];

  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" },
      }
    );
    cachedPrices[symbol] = res.data.data[symbol].quote.USD.price;
    lastPriceFetch = Date.now();
    return cachedPrices[symbol];
  } catch {
    return symbol === "SOL" ? 0 : 1;
  }
}

/* ================= ALERT ================= */

async function sendAlert(amount, symbol, tx) {
  const price = await getPrice(symbol);
  const usd = amount * price;

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>
💵 <b>$${usd.toFixed(2)} USD</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    await bot.sendPhoto(chat, LOGO, {
      caption,
      parse_mode: "HTML",
    });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ================= SCANNER ================= */

async function scan() {
  try {
    const sigs = await connection.getSignaturesForAddress(WALLET, {
      limit: 20,
    });

    if (!initialized) {
      // 🔥 Skip all old txns on first run
      lastProcessedSignature = sigs[0]?.signature || null;
      initialized = true;
      console.log("✅ Initialized, ignoring previous transactions");
      return;
    }

    for (const sig of sigs.reverse()) {
      if (sig.signature === lastProcessedSignature) continue;

      lastProcessedSignature = sig.signature;

      const tx = await connection.getParsedTransaction(sig.signature);
      if (!tx || !tx.meta) continue;

      /* ---------- SOL ---------- */
      const solDiff =
        (tx.meta.postBalances[0] - tx.meta.preBalances[0]) /
        LAMPORTS_PER_SOL;

      if (solDiff > 0) {
        await sendAlert(solDiff, "SOL", sig.signature);
      }

      /* ---------- TOKENS ---------- */
      const instructions = [
        ...tx.transaction.message.instructions,
        ...(tx.meta.innerInstructions || []).flatMap((i) => i.instructions),
      ];

      for (const ix of instructions) {
        if (
          ix.program === "spl-token" &&
          ix.parsed?.type === "transfer" &&
          ix.parsed.info.destination === WALLET.toString()
        ) {
          const mint = ix.parsed.info.mint;
          const amount =
            Number(ix.parsed.info.amount) / 10 ** 6;

          if (mint === TOKENS.USDT.mint) {
            await sendAlert(amount, "USDT", sig.signature);
          }

          if (mint === TOKENS.USDC.mint) {
            await sendAlert(amount, "USDC", sig.signature);
          }
        }
      }
    }
  } catch (e) {
    console.log("Scan error:", e.message);
  }
}

/* ================= START ================= */

console.log("🚀 SOL + USDT + USDC Tracker Running (REALTIME HTTPS)");
setInterval(scan, POLL_INTERVAL);