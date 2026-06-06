import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-url.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedAdmin() {
    console.log('🌱 Seeding Super Admin Account...');
    
    const adminData = {
        first_name: 'System',
        last_name: 'Administrator',
        email: 'admin@cpoint.com',
        role: 'admin',
        department: 'IT',
        job_title: 'Super Admin',
        salary: 150000
    };

    const password = 'AdminPassword123!';

    try {
        // 1. Create Auth User
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: adminData.email,
            password: password,
            email_confirm: true,
            user_metadata: { first_name: adminData.first_name, last_name: adminData.last_name, role: adminData.role }
        });

        if (authError) {
            if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
                console.log('⚠️ Admin already exists in Auth. Please delete it manually in Supabase if you want to re-seed.');
                return;
            } else {
                throw authError;
            }
        }

        const userId = authData?.user?.id;
        if (!userId) {
            console.log('Failed to retrieve User ID.');
            return;
        }

        // 2. Hash Email
        const APP_KEY = process.env.APP_KEY || 'default_fallback_key';
        const lookupHash = crypto.createHash('sha256').update(adminData.email.toLowerCase() + APP_KEY).digest('hex');

        // 3. Insert into Employees Table
        const { error: empError } = await supabase
            .from('employees')
            .upsert({
                id: userId,
                auth_user_id: userId,
                first_name: adminData.first_name,
                last_name: adminData.last_name,
                email: adminData.email,
                role: adminData.role,
                department: adminData.department,
                job_title: adminData.job_title,
                salary: adminData.salary,
                email_hash: lookupHash,
                status: 'active',
                requires_password_change: false
            });

        if (empError) throw empError;

        console.log('✅ Super Admin seeded successfully!');
        console.log('-----------------------------------');
        console.log(`📧 Email: ${adminData.email}`);
        console.log(`🔑 Password: ${password}`);
        console.log('-----------------------------------');

    } catch (err) {
        console.error('❌ Error seeding admin:', err.message);
    }
}

seedAdmin();
