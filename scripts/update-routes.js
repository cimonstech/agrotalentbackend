// Script to update all route files to use shared Supabase client
// This is a helper script - routes should be updated manually for better control

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../src/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

console.log('Route files found:', files);

// This script is informational - actual updates should be done manually
// to ensure proper error handling and context
