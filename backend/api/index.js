/*  Vercel serverless entry — serves the entire Express app.
    The vercel.json rewrite sends every request here; Express does the routing. */
require('../env-alias');                 // map *_PROJECT_REPO -> base names, first
module.exports = require('../app');
