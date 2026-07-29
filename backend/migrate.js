import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

async function migrate() {
    console.log('Connecting to Supabase...');
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        console.log('Connected. Running ALTER TABLE...');
        
        await client.query(`
            ALTER TABLE employees 
            ADD COLUMN IF NOT EXISTS has_registered_biometrics BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS biometric_baseline_path TEXT,
            ADD COLUMN IF NOT EXISTS biometric_registered_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS biometric_liveness_confidence REAL;
        `);
        console.log('SUCCESS: Added biometric tracking columns to the database schema!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

migrate();
