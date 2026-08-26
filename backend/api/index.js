/*  Vercel serverless entry — serves the entire Express app.
    The vercel.json rewrite sends every request here; Express does the routing. */
module.exports = require('../app');
