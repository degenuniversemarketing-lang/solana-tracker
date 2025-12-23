const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

/* ================= CONFIG ================= */
const RPC_HTTP = "https://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const RPC_WS = "wss://tame-light-tab.solana-mainnet.quiknode.pro/ad61b3223f4d19dd02b5373b2843318e8c3ea619/";
const connection = new Connection(RPC_HTTP, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_IDS = process.env.CHAT_IDS.split(',');
const WALLET = process.env.WALLET_ADDRESS;

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CHECK_INTERVAL = 15000;
const MIN_AMOUNT = { SOL: 0.01, USDT: 1, USDC: 1 };

const LOGO_URL = "https://i.postimg.cc/85VrXsyt/Whats-App-Image-2025-12-23-at-12-19-02-AM.jpg";
const CMC_API_KEY = "27cd7244e4574e70ad724a5feef7ee10";

/* ================= STATE ================= */
const processedSignatures = new Set();
const MAX_SIG_CACHE = 5000;
let priceCache = { SOL: 0, USDT: 1, USDC: 1, ts: 0 };
let wsConnected = false;

/* ================= PRICE FETCH ================= */
async function getPrices() {
    if (Date.now() - priceCache.ts < 60000) return priceCache;
    try {
        const res = await axios.get(
            "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
            {
                headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
                params: { symbol: "SOL,USDT,USDC", convert: "USD" }
            }
        );
        priceCache = {
            SOL: res.data.data.SOL.quote.USD.price,
            USDT: 1,
            USDC: 1,
            ts: Date.now()
        };
    } catch {}
    return priceCache;
}

/* ================= ALERT FUNCTION ================= */
async function sendAlert(type, amount, sig) {
    const prices = await getPrices();
    const usd = (amount * prices[type]).toFixed(2);
    const caption = `
🚨 <b>New Buy Alert!</b>

💰 <b>${amount.toFixed(4)} ${type}</b> ( $${usd} )

🔗 <a href="https://solscan.io/tx/${sig}">View Transaction</a>
`.trim();

    for (const chat of CHAT_IDS) {
        try {
            await bot.sendPhoto(chat, LOGO_URL, { caption, parse_mode: "HTML" });
            await new Promise(r => setTimeout(r, 1200)); // throttle
        } catch {
            await bot.sendMessage(chat, caption, { parse_mode: "HTML" });
        }
    }
    console.log(`✅ ${type} alert: ${amount}`);
}

/* ================= WS HANDLER ================= */
function startWebSocket() {
    const ws = new WebSocket(RPC_WS);

    ws.on('open', () => {
        wsConnected = true;
        console.log("🔵 WebSocket connected for real-time tracking");

        const subMsg = {
            jsonrpc: "2.0",
            id: 1,
            method: "logsSubscribe",
            params: [
                { mentions: [WALLET] },
                { commitment: "confirmed" }
            ]
        };
        ws.send(JSON.stringify(subMsg));
    });

    ws.on('message', async (data) => {
        const msg = JSON.parse(data);
        if (!msg.params?.result) return;
        const sig = msg.params.result.signature;
        if (processedSignatures.has(sig)) return;
        processedSignatures.add(sig);
        if (processedSignatures.size > MAX_SIG_CACHE)
            processedSignatures.delete(processedSignatures.values().next().value);

        try {
            const tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
            if (!tx || !tx.meta) return;

            // SOL
            const solDiff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
            if (solDiff >= MIN_AMOUNT.SOL) await sendAlert("SOL", solDiff, sig);

            // Tokens
            const instructions = [
                ...(tx.transaction.message.instructions || []),
                ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)
            ];

            for (const ix of instructions) {
                if (ix.program !== "spl-token") continue;
                if (ix.parsed?.type !== "transfer") continue;
                if (ix.parsed.info.destination !== WALLET) continue;

                const mint = ix.parsed.info.mint;
                const amount = Number(ix.parsed.info.amount) / 1e6;
                if (amount < (mint === USDT_MINT ? MIN_AMOUNT.USDT : MIN_AMOUNT.USDC)) continue;

                if (mint === USDT_MINT) await sendAlert("USDT", amount, sig);
                if (mint === USDC_MINT) await sendAlert("USDC", amount, sig);
            }
        } catch {}
    });

    ws.on('close', () => {
        wsConnected = false;
        console.log("⚠️ WebSocket closed, fallback to polling");
        setTimeout(startWebSocket, 5000);
    });

    ws.on('error', (err) => {
        wsConnected = false;
        console.log("⚠️ WebSocket error, reconnecting", err.message);
        setTimeout(startWebSocket, 5000);
    });
}

/* ================= POLLING FALLBACK ================= */
async function pollFallback() {
    if (wsConnected) return; // only fallback if WS disconnected
    try {
        const sigs = await connection.getSignaturesForAddress(new PublicKey(WALLET), { limit: 20 });
        for (const s of sigs) {
            if (processedSignatures.has(s.signature)) continue;
            processedSignatures.add(s.signature);
            if (processedSignatures.size > MAX_SIG_CACHE)
                processedSignatures.delete(processedSignatures.values().next().value);

            const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx || !tx.meta) continue;

            // SOL
            const solDiff = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
            if (solDiff >= MIN_AMOUNT.SOL) await sendAlert("SOL", solDiff, s.signature);

            // Tokens
            const instructions = [
                ...(tx.transaction.message.instructions || []),
                ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)
            ];
            for (const ix of instructions) {
                if (ix.program !== "spl-token") continue;
                if (ix.parsed?.type !== "transfer") continue;
                if (ix.parsed.info.destination !== WALLET) continue;

                const mint = ix.parsed.info.mint;
                const amount = Number(ix.parsed.info.amount) / 1e6;
                if (amount < (mint === USDT_MINT ? MIN_AMOUNT.USDT : MIN_AMOUNT.USDC)) continue;

                if (mint === USDT_MINT) await sendAlert("USDT", amount, s.signature);
                if (mint === USDC_MINT) await sendAlert("USDC", amount, s.signature);
            }
        }
    } catch {}
    setTimeout(pollFallback, CHECK_INTERVAL);
}

/* ================= TEST COMMANDS ================= */
bot.onText(/\/test_sol/, msg => sendAlert("SOL", 0.1234, "TEST_SOL"));
bot.onText(/\/test_usdt/, msg => sendAlert("USDT", 123.45, "TEST_USDT"));
bot.onText(/\/test_usdc/, msg => sendAlert("USDC", 456.78, "TEST_USDC"));

/* ================= START ================= */
console.log("🚀 SOL + USDT + USDC Tracker Running (Hybrid WS + Polling, USD enabled)");
startWebSocket();
pollFallback();