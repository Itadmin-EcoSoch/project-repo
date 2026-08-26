/*  backend/testNewIds.js — throwaway. Mints ids without touching the API,
    so REQUIRE_AUTH is not in the way. Reads the sheet, writes nothing.   */
require('dotenv').config();
const { newProjectId, newClientId, isValidId } = require('./lib/uniqueId');

(async () => {
  console.log('Project_ID');
  for (let i = 0; i < 5; i++) {
    const id = await newProjectId({ fresh: i === 0 });
    console.log(`   ${id}   uppercase-only? ${/^[0-9A-Z]{8}$/.test(id)}   valid? ${isValidId('projects', id)}`);
  }
  console.log('Client_Id');
  for (let i = 0; i < 5; i++) {
    const id = await newClientId({ fresh: i === 0 });
    console.log(`   ${id}   uppercase-only? ${/^[0-9A-Z]{8}$/.test(id)}   valid? ${isValidId('clients', id)}`);
  }
  process.exit(0);
})();