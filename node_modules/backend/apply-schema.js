import fs from 'fs';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The Supabase Connection String (Direct or Transaction pooling)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('Error: DATABASE_URL is missing in your environment variables.');
    console.error('Please add your Supabase Postgres connection string to execute this schema.');
    process.exit(1);
}

const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function applySchema() {
    try {
        await client.connect();
        console.log('Connected to Supabase PostgreSQL database.');

        const sqlFilePath = path.join(__dirname, '../1-to-1-supabase-schema.sql');
        const sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

        console.log('Applying 1-to-1-supabase-schema.sql...');
        
        await client.query(sqlScript);
        
        console.log('Schema applied successfully!');
    } catch (err) {
        console.error('Failed to apply schema:', err.message);
    } finally {
        await client.end();
    }
}

applySchema();
