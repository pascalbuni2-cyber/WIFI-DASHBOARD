require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to SQLite database
const db = new sqlite3.Database('database.db', (err) => {
  if (!err) {
    db.run(`CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      amount INTEGER,
      receipt TEXT,
      time TEXT
    )`);
  }
});

// Helper function to get live Safaricom Access Token
async function getMpesaToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  try {
    // Note: URL changes from 'sandbox' to 'api' for live apps
    const response = await axios.get(
      'https://safaricom.co.ke',
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Token Error:', error.message);
    throw error;
  }
}

// ROUTE 1: The Vendor Dashboard (Admin view)
app.get('/admin', (req, res) => {
  db.get(`SELECT SUM(amount) as total FROM sales`, [], (err, row) => {
    const totalRevenue = row ? row.total || 0 : 0;
    db.all(`SELECT * FROM sales ORDER BY id DESC LIMIT 15`, [], (err, rows) => {
      let html = '<div style="font-family: Arial; max-width: 650px; margin: 30px auto; padding: 25px; border: 1px solid #ccc; border-radius: 12px;">';
      html += '<h2>📊 Pascal Wi-Fi — Vendor Panel</h2>';
      html += '<div style="background: green; padding: 18px; border-radius: 8px; color: white; text-align: center;">';
      html += '<h3>Total Revenue: KSH ' + totalRevenue + '</h3></div>';
      html += '<p><a href="/">← Go to Customer Login</a></p>';
      html += '<h3>📜 Real Wi-Fi Sales Log</h3>';
      html += '<table style="width: 100%; border-collapse: collapse; text-align: left;">';
      html += '<tr><th>Phone</th><th>Amount</th><th>Receipt</th><th>Time</th></tr>';
      
      if (rows && rows.length > 0) {
        rows.forEach(sale => {
          html += '<tr><td>' + sale.phone + '</td><td>KSH ' + sale.amount + '</td><td>' + sale.receipt + '</td><td>' + sale.time + '</td></tr>';
        });
      } else {
        html += '<tr><td colspan="4">No sales recorded yet.</td></tr>';
      }
      html += '</table></div>';
      res.send(html);
    });
  });
});

// ROUTE 2: The Customer Wi-Fi Login Page (With Pop-up Modal)
app.get('/', (req, res) => {
  let html = '<div style="font-family: Arial, sans-serif; max-width: 400px; margin: 40px auto; padding: 30px; border: 1px solid #ccc; border-radius: 16px; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">';
  html += '<h2>🚀 Pascal Wi-Fi Hotspot</h2>';
  html += '<p style="color: #666;">Select your preferred internet package below:</p>';
  
  // Package Buttons
  html += '<div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">';
  html += '<button onclick="openPopup(5)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">⏱️ 10 Mins — KSH 5</button>';
  html += '<button onclick="openPopup(10)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">🕐 1 Hour — KSH 10</button>';
  html += '<button onclick="openPopup(20)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">🕒 3 Hours — KSH 20</button>';
  html += '<button onclick="openPopup(50)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">📅 24 Hours — KSH 50</button>';
  html += '<button onclick="openPopup(200)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">🗓️ 7 Days — KSH 200</button>';
  html += '<button onclick="openPopup(500)" style="padding: 14px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;">🚀 30 Days — KSH 500</button>';
  html += '</div>';
  
  // POP-UP MODAL
  html += '<div id="popupOverlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">';
  html += '  <div style="background: white; padding: 25px; border-radius: 12px; width: 85%; max-width: 320px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); position: relative; margin: 150px auto; text-align: left;">';
  html += '    <span onclick="closePopup()" style="position: absolute; top: 10px; right: 15px; font-size: 20px; color: #aaa; cursor: pointer; font-weight: bold;">&times;</span>';
  html += '    <h3 style="margin-top: 0; color: #2c3e50;">Confirm Payment</h3>';
  html += '    <p style="margin: 5px 0 15px 0; color: #555;">Selected Package: <b>KSH <span id="popupAmount">0</span></b></p>';
  html += '    <label style="font-size: 13px; font-weight: bold;">Enter Safaricom Number:</label>';
  html += '    <input type="text" id="customerPhone" placeholder="e.g. 011774901" style="width: 100%; padding: 12px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; margin: 6px 0 15px 0; font-size: 15px;">';
  html += '    <button onclick="submitPay()" style="width: 100%; padding: 12px; background: #4cd137; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 15px;">🔑 Pay via M-Pesa</button>';
  html += '  </div>';
  html += '</div>';
  
  html += '<script>';
  html += 'var selectedAmount = 0;';
  html += 'function openPopup(amt){';
  html += '  selectedAmount = amt;';
  html += '  document.getElementById("popupAmount").innerText = amt;';
  html += '  document.getElementById("popupOverlay").style.display = "block";';
  html += '  document.getElementById("customerPhone").focus();';
  html += '}';
  html += 'function closePopup(){';
  html += '  document.getElementById("popupOverlay").style.display = "none";';
  html += '}';
  html += 'function submitPay(){';
  html += '  var ph = document.getElementById("customerPhone").value.trim();';
  html += '  if(!ph){ alert("Please enter your phone number first!"); return; }';
  // Convert leading 0 to 254 for Safaricom format
  if(ph.startsWith("0")) { ph = "254" + ph.substring(1); }
  html += '  window.location.href = "/buy-wifi?phone=" + ph + "&amount=" + selectedAmount;';
  html += '}';
  html += '</script>';
  
  html += '<p style="margin-top: 25px; font-size: 12px; color: #777;">Support: <b>011774901</b></p></div>';
  res.send(html);
});

// ROUTE 3: Sends real STK Push prompt to the phone via Daraja API
app.get('/buy-wifi', async (req, res) => {
  let phone = req.query.phone || '25411774901';
  const amount = req.query.amount || '10';

  try {
    const token = await getMpesaToken();
    const date = new Date();
    const timestamp = date.getFullYear() +
      ('0' + (date.getMonth() + 1)).slice(-2) +
      ('0' + date.getDate()).slice(-2) +
      ('0' + date.getHours()).slice(-2) +
      ('0' + date.getMinutes()).slice(-2) +
      ('0' + date.getSeconds()).slice(-2);

    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // Build the dynamic callback URL pointing to your online cloud server
    const serverUrl = process.env.SERVER_URL || 'https://ngrok-free.dev';

    const mpesaData = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerBuyGoodsOnline', // Changes to 'CustomerBuyGoodsOnline' for standard Till numbers
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: `${serverUrl}/mpesa-callback`, 
      AccountReference: 'PascalWiFi',
      TransactionDesc: 'WiFi Payment'
    };

    // Note: URL changes to 'api' instead of 'sandbox'
    await axios.post(
      'https://safaricom.co.ke',
      mpesaData,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let out = '<div style="font-family: Arial; max-width: 400px; margin: 80px auto; text-align: center;">';
    out += '<h2>Connecting to Pascal Wi-Fi...</h2>';
    out += '<p>M-Pesa prompt initiated for KSH <b>' + amount + '</b> on phone <b>' + phone + '</b>.</p>';
    out += '<p style="color: #718093;">Please unlock your screen and enter your M-Pesa PIN to connect.</p>';
    out += '<p><a href="/">Go Back</a></p></div>';
    res.send(out);
  } catch (error) {
    res.status(500).send('M-Pesa Live Error: ' + (error.response ? JSON.stringify(error.response.data) : error.message));
  }
});

// ROUTE 4: Real endpoint that Safaricom secretly hits after customer enters PIN
app.post('/mpesa-callback', (req, res) => {
  console.log('Safaricom sent callback payment notification!');
  
  const body = req.body.Body;
  if (!body || !body.stkCallback) {
    return res.sendStatus(400);
  }

  const callbackData = body.stkCallback;
  
  // ResultCode 0 means payment was successful!
  if (callbackData.ResultCode === 0) {
    const metaData = callbackData.CallbackMetadata.Item;
    
    let amount = 0;
    let receipt = '';
    let phone = '';
    
    metaData.forEach(item => {
      if (item.Name === 'Amount') amount = item.Value;
      if (item.Name === 'MpesaReceiptNumber') receipt = item.Value;
      if (item.Name === 'PhoneNumber') phone = item.Value;
    });

