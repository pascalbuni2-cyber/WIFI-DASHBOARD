const express = require('express');
const axios = require('axios');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

// Create or open a database file named wifi_business.db
const db = new sqlite3.Database('./wifi_business.db', (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to the Wi-Fi business database.");
});

// Create tables for payments and business owners
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        name TEXT,
        mpesa_shortcode TEXT,
        router_ip TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT,
        phone TEXT,
        amount REAL,
        vendor_id TEXT,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 1. GET ACCESS TOKEN FROM SAFARICOM
async function getMpesaToken(req, res, next) {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');

    try {
        const response = await axios.get(
            'https://safaricom.co.ke',
            { headers: { Authorization: `Basic ${auth}` } }
        );
        req.mpesaToken = response.data.access_token;
        next();
    } catch (error) {
        console.error("Token Error:", error.message);
        res.status(500).send("Failed to get M-Pesa token");
    }
}

// 2. SEND M-PESA POP-UP (STK PUSH) TO PHONE
app.post('/stkpush', getMpesaToken, async (req, res) => {
    const phone = req.body.phone; // Format must be 2547XXXXXXXX
    const amount = req.body.amount;
    const vendorId = req.body.vendorId || "vendor_01"; 

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

    const stkPayload = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: "https://yourdomain.com", 
        AccountReference: vendorId, 
        TransactionDesc: "WiFi Access"
    };

    try {
        const response = await axios.post(
            'https://safaricom.co.ke',
            stkPayload,
            { headers: { Authorization: `Bearer ${req.mpesaToken}` } }
        );
        res.status(200).json(response.data);
    } catch (error) {
        console.error("STK Push Error:", error.response ? error.response.data : error.message);
        res.status(500).send("STK Push failed");
    }
});

// 3. RECEIVE M-PESA PAYMENT RESULTS (CALLBACK) & SAVE TO DATABASE
app.post('/callback', (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const resultCode = callbackData.ResultCode;

    if (resultCode === 0) {
        const itemArray = callbackData.CallbackMetadata.Item;
        
        const amountItem = itemArray.find(item => item.Name === 'Amount');
        const phoneItem = itemArray.find(item => item.Name === 'PhoneNumber');
        const receiptItem = itemArray.find(item => item.Name === 'MpesaReceiptNumber');

        const paidAmount = amountItem ? amountItem.Value : 0;
        const userPhone = phoneItem ? phoneItem.Value : 'Unknown';
        const receipt = receiptItem ? receiptItem.Value : 'N/A';
        
        const vendorId = req.body.Body.stkCallback.AccountReference || "vendor_01"; 

        const query = `INSERT INTO payments (receipt_number, phone, amount, vendor_id, status) VALUES (?, ?, ?, ?, ?)`;
        db.run(query, [receipt, userPhone, paidAmount, vendorId, 'SUCCESS'], function(err) {
            if (err) console.error("Error saving to database:", err.message);
            else console.log(`💾 Saved to Database! Record ID: ${this.lastID} for Business: ${vendorId}`);
        });

        console.log(`💰 SUCCESS! ${userPhone} paid KSH ${paidAmount}. Receipt: ${receipt}`);
        
        console.log("--------------------------------------------------");
        console.log(`📡 [ROUTER COMMAND] Unlocking router for Business: ${vendorId}`);
        console.log(`🔓 SUCCESS: Internet access has been UNLOCKED for phone: ${userPhone}`);
        console.log("--------------------------------------------------");
        
    } else {
        console.log(`❌ Payment Failed or Cancelled. Code: ${resultCode}`);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// 4. DATABASE API: FETCH TOTAL EARNINGS AND SALES FOR A BUSINESS OWNER
app.get('/api/earnings/:vendorId', (req, res) => {
    const vendorId = req.params.vendorId;

    // Get all sales rows for this vendor
    db.all(`SELECT * FROM payments WHERE vendor_id = ? ORDER BY id DESC`, [vendorId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Calculate the sum of all earnings
        let totalRevenue = 0;
        rows.forEach(row => totalRevenue += row.amount);

        res.json({
            total: totalRevenue,
            rows: rows
        });
    });
});

app.listen(3000, () => console.log('WiFi Server running on port 3000'));
