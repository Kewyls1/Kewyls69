require('dotenv').config();

module.exports = {
    LZT_API_URL: process.env.LZT_API_URL,
    LZT_API_URL2: process.env.LZT_API_URL2,
    
    STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    
    LZT_API_KEY: process.env.LZT_API_KEY,
    AUTO_REFUND: process.env.AUTO_REFUND?.toLowerCase() === 'true',
    
    HEADERS: {
        'Authorization': `Bearer ${process.env.LZT_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    },
    
    EXCHANGE_RATE: parseFloat(process.env.EXCHANGE_RATE) || 4.3,
    MARKUP: parseFloat(process.env.MARKUP) || 2.0
};