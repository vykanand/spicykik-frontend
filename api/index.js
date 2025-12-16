const app = require('../server');

// Vercel will call this exported function as the serverless handler.
module.exports = (req, res) => app(req, res);
