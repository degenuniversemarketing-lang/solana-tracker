const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC =
  "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";

const connection = new Connection(RPC, "confirmed");
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = new PublicKey(process.env.WALLET_ADDRESS);

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL || 15000);
const MIN_SOL = Number(process.env.MIN_ALERT_SOL || 0.01);
const MIN_TOKEN = Number(process.env.MIN_ALERT_TOKEN || 1);

const LOGO =
  "https://i.postimg.cc/5NpFMTry/Whats-App-Image-2025-12-21-at-1-29-09-AM.jpg";

/* ================= CMC ================= */

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

const priceCache = {};
const PRICE_TTL = 60_000;

/* ================= TOKENS ================= */

const TOKENS = {
  SOL: { symbol: "SOL" },
  USDT: {
    mint: new PublicKey(
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
    ),
    decimals: 6
  },
  USDC: {
    mint: new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ),
    decimals: 6
  }
};

/* ================= STATE ================= */

const seenTx = new Set();

/* ================= PRICE ================= */

async function getPrice(symbol) {
  if (
    priceCache[symbol] &&
    Date.now() - priceCache[symbol].time < PRICE_TTL
  ) {
    return priceCache[symbol].price;
  }

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

/* ================= ALERT ================= */

async function sendAlert(title, amount, symbol, tx) {
  const price = await getPrice(symbol);
  const usd = amount * price;

  const caption = `
🚨 <b>${title}</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>
💵 <b>$${usd.toFixed(2)} USD</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO, {
        caption,
        parse_mode: "HTML"
      });
      await new Promise(r => setTimeout(r, 900));
    } catch (e) {
      console.log("Telegram error:", e.message);
    }
  }
}

/* ================= SOL SCAN ================= */

async function scanSOL() {
  const sigs = await connection.getSignaturesForAddress(WALLET, { limit: 5 });

  for (const sig of sigs) {
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
      await sendAlert("SOL Transfer", diff, "SOL", sig.signature);
    }
  }
}

/* ================= TOKEN SCAN ================= */

async function scanToken(symbol, mint, decimals) {
  const accounts = await connection.getParsedTokenAccountsByOwner(WALLET, {
    mint
  });

  if (!accounts.value.length) return;

  const tokenAccount = new PublicKey(accounts.value[0].pubkey);

  const sigs = await connection.getSignaturesForAddress(tokenAccount, {
    limit: 5
  });

  for (const sig of sigs) {
    if (seenTx.has(sig.signature)) continue;

    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx) continue;

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions || []).flatMap(i => i.instructions)
    ];

    for (const ix of instructions) {
      if (
        ix.program === "spl-token" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.destination === tokenAccount.toString()
      ) {
        const amount =
          Number(ix.parsed.info.amount) / Math.pow(10, decimals);

        if (amount >= MIN_TOKEN) {
          seenTx.add(sig.signature);
          await sendAlert(`${symbol} Transfer`, amount, symbol, sig.signature);
          break;
        }
      }
    }
  }
}

/* ================= LOOP ================= */

async function start() {
  console.log("🚀 SOL + USDT + USDC Tracker Running (USD enabled)");

  setInterval(async () => {
    try {
      await scanSOL();
      await scanToken("USDT", TOKENS.USDT.mint, TOKENS.USDT.decimals);
      await scanToken("USDC", TOKENS.USDC.mint, TOKENS.USDC.decimals);
    } catch (e) {
      console.log("Scan error:", e.message);
    }
  }, CHECK_INTERVAL);
}

start();

/* ================= TEST COMMANDS ================= */

bot.onText(/\/test_sol/, () => {
  sendAlert("SOL Test Alert", 12.5, "SOL", "test_tx");
});

bot.onText(/\/test_usdt/, () => {
  sendAlert("USDT Test Alert", 500, "USDT", "test_tx");
});

bot.onText(/\/test_usdc/, () => {
  sendAlert("USDC Test Alert", 1000, "USDC", "test_tx");
});
