// Simplified server to isolate the hanging issue
// Adding dependencies one by one to find the culprit

console.log('Starting simplified server...');

// Load environment variables - this might be the issue
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

console.log('Environment loaded');

const express = require('express');
console.log('Express loaded');

const cors = require('cors');
console.log('CORS loaded');

const app = express();
const PORT = 5003;

console.log('App created');

// Add CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, 'https://your-deployed-app.com'] 
    : true,
  credentials: true
}));

console.log('CORS middleware added');

app.use(express.json());
console.log('JSON middleware added');

// Simple health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

console.log('Health route added');

app.listen(PORT, () => {
  console.log(`Simplified server listening on port ${PORT}`);
});

console.log('Listen called');