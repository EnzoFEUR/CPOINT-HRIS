import 'dotenv/config';
import fs from 'fs';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('Error: DATABASE_URL is missing in your environment variables.');
    process.exit(1);
}

const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function applySchema() {
    try {
        await client.connect();
        const sqlFilePath = path.join(__dirname, 'notifications_schema.sql');
        const sqlScript = fs.readFileSync(sqlFilePath, 'utf8');
        await client.query(sqlScript);
        console.log('Notifications schema applied successfully!');
    } catch (err) {
        console.error('Failed to apply schema:', err.message);
    } finally {
        await client.end();
    }
}

applySchema();
