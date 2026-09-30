import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { getLeaveSummaryForPeriod } from '../utils/leaveUtils.js';

const router = express.Router();

// Dedicated payroll integration endpoint: Get leave summary (paid vs unpaid) for pay period
router.get('/summary', cacheResponse(30), async (req, res) => {
    try {
        const { employee_id, start_date, end_date } = req.query;
        if (!employee_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'employee_id, start_date, and end_date are required query parameters.' });
        }

        const summary = await getLeaveSummaryForPeriod({
            employeeId: employee_id,
            periodStart: start_date,
            periodEnd: end_date
        });

        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        let query = supabase.from('leave_requests').select('*, employees:employee_id(*)').order('created_at', { ascending: false });
        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }
        const { data, error } = await query;
        if (error) throw error;
        
        const leaves = (data || []).map(leave => {
            const rawNotes = leave.notes || '';
            const isExplicitUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(rawNotes) || /\[UNPAID\]/i.test(rawNotes);
            const isPaid = isExplicitUnpaid ? false : true;
            const payType = isPaid ? 'with_pay' : 'without_pay';
            const cleanNotes = rawNotes
                .replace(/\[PAY_TYPE:[^\]]+\]/gi, '')
                .replace(/\[(PAID|UNPAID)\]/gi, '')
                .trim();

            const s = new Date(leave.start_date);
            const e = new Date(leave.end_date);
            const daysCount = (!isNaN(s.getTime()) && !isNaN(e.getTime()))
                ? Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1)
                : 1;

            return {
                ...leave,
                notes: cleanNotes,
                raw_notes: rawNotes,
                is_paid: isPaid,
                pay_type: payType,
                days_count: daysCount
            };
        });

        res.json(leaves);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { employee_id, leave_type, start_date, end_date, reason } = req.body;
        
        // Strict Field Validation
        if (!employee_id) {
            return res.status(400).json({ error: 'Missing employee_id' });
        }
        if (!leave_type || typeof leave_type !== 'string') {
            return res.status(400).json({ error: 'Invalid leave_type' });
        }
        if (!start_date || isNaN(Date.parse(start_date))) {
            return res.status(400).json({ error: 'Invalid start_date' });
        }
        if (!end_date || isNaN(Date.parse(end_date)) || new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ error: 'Invalid end_date or end_date is before start_date' });
        }
        if (!reason || typeof reason !== 'string' || reason.length > 255) {
            return res.status(400).json({ error: 'Invalid reason: max 255 chars' });
        }

        // 1. Account Lifecycle & Standing Verification
        const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, status, is_active, archived_at')
            .eq('id', employee_id)
            .maybeSingle();

        if (empErr || !emp) {
            return res.status(404).json({ error: 'Employee record not found.' });
        }

        const isSuspended = emp.status === 'Suspended' || emp.status === 'suspended';
        const isTerminated = emp.status === 'Terminated' || emp.status === 'terminated';

        if (isSuspended) {
            return res.status(403).json({ 
                error: 'ACCESS RESTRICTED: Leave filing is prohibited while account is under disciplinary suspension.' 
            });
        }

        if (isTerminated || emp.archived_at || emp.is_active === false) {
            return res.status(403).json({ 
                error: 'ACCESS DENIED: Personnel account has been separated or deactivated.' 
            });
        }

        // 2. Overlapping Leave Request Prevention
        const { data: overlappingLeaves } = await supabase
            .from('leave_requests')
            .select('id, start_date, end_date, status, type')
            .eq('employee_id', employee_id)
            .in('status', ['New', 'Pending', 'Approved'])
            .lte('start_date', end_date)
            .gte('end_date', start_date);

        if (overlappingLeaves && overlappingLeaves.length > 0) {
            const conflict = overlappingLeaves[0];
            return res.status(409).json({ 
                error: `A leave request (${conflict.type}) is already active or pending for overlapping dates (${conflict.start_date} to ${conflict.end_date}).` 
            });
        }

        // 3. Insert Request
        const { data: insertedLeave, error } = await supabase
            .from('leave_requests')
            .insert({
                employee_id,
                type: leave_type,
                start_date,
                end_date,
                notes: reason,
                status: 'New'
            })
            .select('*')
            .single();

        if (error) throw error;
        
        // Fetch sender employee details for rich notification
        const senderName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
        const avatarUrl = emp.company_id && emp.id 
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        await createNotification({
            target: 'admin',
            title: `Leave Request: ${senderName}`,
            text: `${senderName} submitted a ${leave_type} request (${start_date} to ${end_date}).`,
            type: 'leave',
            sender_id: emp.id,
            company_id: emp.company_id,
            sender_name: senderName,
            sender_avatar: avatarUrl
        });

        invalidateCache(['/api/leaves', '/api/dashboard']);

        // Real-time broadcast to admin leave dashboard
        try {
            const ch = supabase.channel('admin-leaves-sync');
            ch.send({
                type: 'broadcast',
                event: 'LEAVE_REQUEST_CREATED',
                payload: {
                    ...insertedLeave,
                    employee_name: senderName,
                    company_id: emp.company_id
                }
            }).catch(() => {});
        } catch (_) {}

        res.json({ success: true, message: 'Leave request submitted successfully!', data: insertedLeave });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/status', async (req, res) => {
    try {
        const { status, pay_type, is_paid } = req.body;
        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // Fetch current leave record first
        const { data: currentLeave, error: fetchErr } = await supabase
            .from('leave_requests')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !currentLeave) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        const isApproved = status === 'Approved';
        const leaveIsPaid = isApproved 
            ? (pay_type === 'without_pay' || is_paid === false ? false : true)
            : false;

        const rawNotes = currentLeave.notes || '';
        const cleanNotes = rawNotes
            .replace(/\[PAY_TYPE:[^\]]+\]/gi, '')
            .replace(/\[(PAID|UNPAID)\]/gi, '')
            .trim();

        const updatedNotes = isApproved
            ? `${cleanNotes} [PAY_TYPE:${leaveIsPaid ? 'WITH_PAY' : 'WITHOUT_PAY'}]`.trim()
            : cleanNotes;

        const { data: updatedLeave, error } = await supabase
            .from('leave_requests')
            .update({ 
                status,
                notes: updatedNotes
            })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;

        // Auto-synchronize dates to attendances table
        const startDate = new Date(currentLeave.start_date);
        const endDate = new Date(currentLeave.end_date);
        
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            const cur = new Date(startDate);
            const datesToSync = [];
            while (cur <= endDate) {
                const year = cur.getFullYear();
                const month = String(cur.getMonth() + 1).padStart(2, '0');
                const day = String(cur.getDate()).padStart(2, '0');
                datesToSync.push(`${year}-${month}-${day}`);
                cur.setDate(cur.getDate() + 1);
            }

            if (isApproved) {
                // Upsert placeholder attendance records:
                // Leave With Pay -> 'On Leave'
                // Leave Without Pay -> 'Absent'
                const targetStatus = leaveIsPaid ? 'On Leave' : 'Absent';
                for (const dateStr of datesToSync) {
                    await supabase
                        .from('attendances')
                        .upsert({
                            employee_id: currentLeave.employee_id,
                            date: dateStr,
                            status: targetStatus,
                            time_in: null,
                            time_out: null
                        }, { onConflict: 'employee_id,date' });
                }
            } else if (status === 'Rejected') {
                // Remove placeholder attendance records if rejecting a previously approved leave
                for (const dateStr of datesToSync) {
                    await supabase
                        .from('attendances')
                        .delete()
                        .eq('employee_id', currentLeave.employee_id)
                        .eq('date', dateStr)
                        .in('status', ['On Leave', 'Absent'])
                        .is('time_in', null);
                }
            }
        }
        
        invalidateCache(['/api/leaves', '/api/dashboard', '/api/attendance', '/api/payroll']);

        if (updatedLeave) {
            const { data: emp } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .eq('id', updatedLeave.employee_id)
                .maybeSingle();

            const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
            const avatarUrl = emp?.company_id && emp?.id 
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            const payNotice = isApproved ? ` (${leaveIsPaid ? 'With Pay' : 'Without Pay / Deducted'})` : '';

            await createNotification({
                target: updatedLeave.employee_id,
                title: `Leave Request: ${status}`,
                text: `Your ${updatedLeave.type || 'leave'} request has been ${status.toLowerCase()}${payNotice}.`,
                type: 'leave',
                sender_id: emp?.id,
                company_id: emp?.company_id,
                sender_name: empName,
                sender_avatar: avatarUrl
            });

            if (req.body.admin_id) {
                const { createAuditLog } = await import('./auditLogs.js');
                await createAuditLog({
                    log_name: 'leaves',
                    description: `Marked leave request ${req.params.id} as ${status}${isApproved ? (leaveIsPaid ? ' (With Pay)' : ' (Without Pay)') : ''}`,
                    subject_type: 'App\\Models\\LeaveRequest',
                    subject_id: req.params.id,
                    event: 'updated',
                    causer_id: req.body.admin_id,
                    properties: { status, is_paid: leaveIsPaid, pay_type: leaveIsPaid ? 'with_pay' : 'without_pay' }
                });
            }

            // Real-time low-latency broadcast (<5ms) to employee and admin channels
            try {
                const targetTopics = [
                    'admin-leaves-sync',
                    `employee-live-dashboard-${updatedLeave.employee_id}`,
                    `dashboard-disciplinary-sync-${updatedLeave.employee_id}`
                ];
                const broadcastPayload = {
                    id: req.params.id,
                    employee_id: updatedLeave.employee_id,
                    status,
                    is_paid: leaveIsPaid,
                    pay_type: leaveIsPaid ? 'with_pay' : 'without_pay',
                    updated_at: new Date().toISOString()
                };
                targetTopics.forEach(topic => {
                    supabase.channel(topic).send({
                        type: 'broadcast',
                        event: 'LEAVE_STATUS_UPDATED',
                        payload: broadcastPayload
                    }).catch(() => {});
                });
            } catch (_) {}
        }

        res.json({ 
            success: true, 
            message: `Leave request ${status.toLowerCase()} successfully!`,
            leave: {
                ...updatedLeave,
                status,
                is_paid: leaveIsPaid,
                pay_type: leaveIsPaid ? 'with_pay' : 'without_pay',
                notes: cleanNotes
            },
            is_paid: leaveIsPaid,
            pay_type: leaveIsPaid ? 'with_pay' : 'without_pay'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
