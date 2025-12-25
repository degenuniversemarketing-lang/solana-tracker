const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

/* ================= CONFIG ================= */

const HELIUS_WSS =
  "wss://mainnet.helius-rpc.com/?api-key=dceddde6-3ce4-476e-b983-2fa2c94e87ba";

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(",");
const WALLET = process.env.WALLET_ADDRESS;

const TOKENS = {
  USDT: {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6
  }
};

const MIN_ALERT = 1;

const LOGO =
  "https://i.postimg.cc/sfBjhT6D/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";

/* ================= STATE ================= */

const seen = new Set();
let ws;

/* ================= ALERT ================= */

async function sendAlert(symbol, amount, sig) {
  const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${symbol}</b>

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

  for (const chat of CHAT_IDS) {
    try {
      await bot.sendPhoto(chat, LOGO, {
        caption,
        parse_mode: "HTML"
      });
      await new Promise(r => setTimeout(r, 800));
    } catch {}
  }
}

/* ================= WS CONNECT ================= */

function connect() {
  ws = new WebSocket(HELIUS_WSS);

  ws.on("open", () => {
    console.log("🟢 Helius WebSocket connected");

    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "transactionSubscribe",
        params: [
          {
            accountInclude: [WALLET]
          },
          {
            commitment: "confirmed",
            encoding: "jsonParsed"
          }
        ]
      })
    );
  });

  ws.on("message", async msg => {
    const data = JSON.parse(msg.toString());
    const tx = data?.params?.result;
    if (!tx) return;

    const sig = tx.transaction.signatures[0];
    if (seen.has(sig)) return;
    seen.add(sig);

    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions || []).flatMap(i => i.instructions)
    ];

    for (const ix of instructions) {
      if (ix.program !== "spl-token") continue;
      if (ix.parsed?.type !== "transfer") continue;

      const mint = ix.parsed.info.mint;
      const amountRaw = Number(ix.parsed.info.amount);

      for (const [symbol, t] of Object.entries(TOKENS)) {
        if (mint === t.mint) {
          const amount = amountRaw / 10 ** t.decimals;
          if (amount >= MIN_ALERT) {
            await sendAlert(symbol, amount, sig);
            return;
          }
        }
      }
    }
  });

  ws.on("close", () => {
    console.log("⚠️ WS closed, reconnecting in 5s");
    setTimeout(connect, 5000);
  });

  ws.on("error", err => {
    console.log("WS error:", err.message);
  });
}

console.log("🚀 USDT + USDC REAL-TIME TRACKER (HELlUS)");
connect();

/* ================= TEST ================= */

bot.onText(/\/test/, msg => {
  sendAlert("USDT", 1234, "test_tx_hash");
});
