require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const config = {
  RPC_URL: process.env.RPC_URL,                
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN, 
  CHAT_IDS: process.env.CHAT_IDS?.split(',') || [],
  WALLET_ADDRESS: process.env.WALLET_ADDRESS,
  USDT_MINT: process.env.USDT_MINT,
  LOGO_URL: 'https://i.postimg.cc/5NpFMTry/Whats-App-Image-2025-12-21-at-1-29-09-AM.jpg',
  LOGO_PATH: path.join(__dirname, 'usdt_logo.jpg'),
  CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL || '15000', 10),
  MIN_ALERT_AMOUNT: parseFloat(process.env.MIN_ALERT_AMOUNT || '1.0'),
  CMC_API_KEY: '27cd7244e4574e70ad724a5feef7ee10',
};

const bot = new TelegramBot(config.TELEGRAM_TOKEN);
const connection = new Connection(config.RPC_URL);
let lastTx = null;

// ================= IMAGE DOWNLOAD =================
async function downloadLogo() {
  if (!fs.existsSync(config.LOGO_PATH)) {
    try {
      const res = await axios.get(config.LOGO_URL, { responseType: 'arraybuffer' });
      fs.writeFileSync(config.LOGO_PATH, Buffer.from(res.data));
      console.log('✅ Logo downloaded');
    } catch (err) {
      console.error('❌ Failed to download logo:', err.message);
    }
  } else {
    console.log('✅ Logo already exists, skipping download');
  }
}

// ================= CMC PRICE =================
async function getUSDTPriceUSD() {
  try {
    const res = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      {
        headers: { 'X-CMC_PRO_API_KEY': config.CMC_API_KEY },
        params: { symbol: 'USDT', convert: 'USD' }
      }
    );
    return res.data.data.USDT.quote.USD.price || 1;
  } catch (err) {
    console.error('⚠️ Failed to fetch USDT price:', err.message);
    return 1;
  }
}

// ================= TELEGRAM ALERT =================
async function sendAlert(amount, usdValue, txHash) {
  const caption = `🚨 New Buy Alert!

💰 ${amount.toFixed(4)} USDT ( $${usdValue.toFixed(2)} )

🔗 View Transaction: https://solscan.io/tx/${txHash}`;

  try {
    const logo = fs.createReadStream(config.LOGO_PATH);
    await Promise.all(config.CHAT_IDS.map(async chatId => {
      try {
        await bot.sendPhoto(chatId, logo, { caption });
        console.log(`✅ Alert sent to ${chatId}`);
      } catch (err) {
        console.error(`❌ Telegram error for ${chatId}:`, err.message);
      }
    }));
  } catch (err) {
    console.error('❌ Error reading logo file:', err.message);
  }
}

// ================= CHECK INCOMING USDT =================
async function checkIncomingUSDT() {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(config.WALLET_ADDRESS),
      { limit: 1 }
    );
    const sig = sigs[0]?.signature;
    if (!sig || sig === lastTx) return;
    lastTx = sig;

    const tx = await connection.getTransaction(sig, { commitment: 'confirmed', encoding: 'jsonParsed' });
    if (!tx?.meta?.postTokenBalances) return;

    const usdtPrice = await getUSDTPriceUSD();

    for (let token of tx.meta.postTokenBalances) {
      if (token.mint === config.USDT_MINT) {
        const amount = parseFloat(token.uiTokenAmount.amount) / Math.pow(10, token.uiTokenAmount.decimals);
        if (amount >= config.MIN_ALERT_AMOUNT) {
          const usdValue = amount * usdtPrice;
          sendAlert(amount, usdValue, sig);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error checking USDT tx:', err.message);
  }
}

// ================= /test COMMAND =================
function listenForTestCommand() {
  let offset = null;
  console.log('🤖 Listening for /test command...');
  setInterval(async () => {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/getUpdates${offset ? `?offset=${offset}` : ''}`);
      const updates = res.data.result || [];
      for (let update of updates) {
        offset = update.update_id + 1;
        if (update.message?.text === '/test') {
          const price = await getUSDTPriceUSD();
          // Send alert using the same template as live transactions
          sendAlert(500, 500 * price, 'TEST_TX');
        }
      }
    } catch (err) {
      console.error('❌ Telegram listener error:', err.message);
    }
  }, 5000);
}

// ================= MAIN =================
(async () => {
  await downloadLogo();
  console.log('🚀 USDT Tracker Online');
  listenForTestCommand();
  setInterval(checkIncomingUSDT, config.CHECK_INTERVAL);
})();