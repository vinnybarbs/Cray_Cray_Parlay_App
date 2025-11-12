// Minimal server to test if the basic setup works
const express = require('express');

console.log('Starting minimal server test...');

const app = express();
const PORT = 5002; // Different port to avoid conflicts

console.log('Express app created');

app.get('/test', (req, res) => {
  res.json({ message: 'Minimal server works!' });
});

console.log('Route added');

app.listen(PORT, () => {
  console.log(`Minimal server listening on port ${PORT}`);
});

console.log('Listen called');