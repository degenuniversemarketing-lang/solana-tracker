const { Connection, PublicKey } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

/* ================= CONFIG ================= */

const connection = new Connection(
  "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/",
  "confirmed"
);

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "15000");
const MIN_ALERT_AMOUNT = parseFloat(process.env.MIN_ALERT_AMOUNT || "1");

const LOGO_URL =
  "https://i.postimg.cc/sfBjhT6D/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= TOKENS ================= */

const TOKENS = {
  USDT: {
    mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    decimals: 6,
    balance: 0
  },
  USDC: {
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
    balance: 0
  }
};

/* ================= PRICE ================= */

async function getPrice(symbol) {
  try {
    const res = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params: { symbol, convert: "USD" }
      }
    );
    return res.data.data[symbol].quote.USD.price || 1;
  } catch {
    return 1;
  }
}

/* ================= ALERT ================= */

async function sendAlert(symbol, amount, tx) {
  const price = await getPrice(symbol);
  const usd = amount * price;

  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>
💵 <b>$${usd.toFixed(2)} USD</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO_URL, {
        caption,
        parse_mode: "HTML"
      });
      await new Promise(r => setTimeout(r, 900));
    } catch (e) {
      console.log("Telegram error:", e.message);
    }
  }
}

/* ================= BALANCE ================= */

async function getTokenBalance(mint) {
  const accounts = await connection.getParsedTokenAccountsByOwner(
    new PublicKey(WALLET_ADDRESS),
    { mint }
  );

  return accounts.value.reduce(
    (sum, acc) =>
      sum + (acc.account.data.parsed.info.tokenAmount.uiAmount || 0),
    0
  );
}

async function getLatestTxHash() {
  const sigs = await connection.getSignaturesForAddress(
    new PublicKey(WALLET_ADDRESS),
    { limit: 1 }
  );
  return sigs[0]?.signature || "unknown_tx";
}

/* ================= MONITOR ================= */

async function monitor() {
  try {
    for (const symbol of Object.keys(TOKENS)) {
      const token = TOKENS[symbol];
      const newBalance = await getTokenBalance(token.mint);
      const diff = newBalance - token.balance;

      if (diff >= MIN_ALERT_AMOUNT) {
        const tx = await getLatestTxHash();
        await sendAlert(symbol, diff, tx);
      }

      token.balance = newBalance;
    }
  } catch (err) {
    console.log("❌ Monitor error:", err.message);
  } finally {
    setTimeout(monitor, CHECK_INTERVAL);
  }
}

/* ================= START ================= */

(async () => {
  console.log("🚀 USDT + USDC Tracker Running (STABLE MODE)");

  for (const symbol of Object.keys(TOKENS)) {
    TOKENS[symbol].balance = await getTokenBalance(TOKENS[symbol].mint);
  }

  monitor();
})();

/* ================= TEST ================= */

bot.onText(/\/test/, msg => {
  sendAlert("USDT", 1234, "test_tx_hash");
});
