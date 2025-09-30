require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const generateParlayHandler = require('./api/generate-parlay');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/generate-parlay', generateParlayHandler);

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});