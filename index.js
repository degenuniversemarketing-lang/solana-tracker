const { Connection, PublicKey } = require("@solana/web3.js");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

/* ================= CONFIG ================= */

const RPC = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(RPC, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

const TOKENS = [
  {
    symbol: "USDT",
    mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    decimals: 6
  },
  {
    symbol: "USDC",
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6
  }
];

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL || 12000);
const MIN_ALERT_AMOUNT = Number(process.env.MIN_ALERT_AMOUNT || 1);

const LOGO_URL =
  "https://i.postimg.cc/sfBjhT6D/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

/* ================= STATE ================= */

const processedTxs = new Set();

/* ================= HELPERS ================= */

async function getTokenAccounts(mint) {
  const res = await connection.getParsedTokenAccountsByOwner(
    new PublicKey(WALLET_ADDRESS),
    { mint }
  );
  return res.value.map(v => v.pubkey.toString());
}

async function sendAlert(symbol, amount, tx) {
  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>

🔗 <a href="https://solscan.io/tx/${tx}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO_URL, {
        caption,
        parse_mode: "HTML"
      });
      await new Promise(r => setTimeout(r, 900)); // anti 429
    } catch (e) {
      console.log("Telegram error:", e.message);
    }
  }
}

/* ================= CORE SCANNER ================= */

async function scanToken(token) {
  const tokenAccounts = await getTokenAccounts(token.mint);

  for (const account of tokenAccounts) {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(account),
      { limit: 10 }
    );

    for (const sig of sigs) {
      if (processedTxs.has(sig.signature)) continue;

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
          tokenAccounts.includes(ix.parsed.info.destination)
        ) {
          const amount =
            Number(ix.parsed.info.amount) / 10 ** token.decimals;

          if (amount >= MIN_ALERT_AMOUNT) {
            processedTxs.add(sig.signature);
            await sendAlert(token.symbol, amount, sig.signature);
            break;
          }
        }
      }
    }
  }
}

/* ================= LOOP ================= */

async function start() {
  console.log("🚀 USDT + USDC Tracker Running (PRO MODE)");

  setInterval(async () => {
    try {
      for (const token of TOKENS) {
        await scanToken(token);
      }
    } catch (e) {
      console.log("Scan error:", e.message);
    }
  }, CHECK_INTERVAL);
}

start();

/* ================= TEST COMMAND ================= */

bot.onText(/\/test/, async msg => {
  await sendAlert("USDC", 5000, "test_tx_hash");
});
