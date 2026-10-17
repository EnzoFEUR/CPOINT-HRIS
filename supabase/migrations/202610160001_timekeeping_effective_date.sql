-- Decouple statutory hire date (legal tenure) from digital timekeeping cutover (biometric timecard tracking).
-- Prevents false historical absences from being synthesized for periods prior to digital system enrollment.
BEGIN;

ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS timekeeping_effective_date date DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.employees.timekeeping_effective_date IS
'Date when digital attendance and biometric tracking became active for this employee. Prior days are treated as legacy untracked tenure rather than unexcused absences.';

-- Backfill existing workforce records so historical data continuity is preserved:
-- For accounts already present, timekeeping begins on hire date or system creation date.
UPDATE public.employees
SET timekeeping_effective_date = COALESCE(date_hired, (created_at AT TIME ZONE 'Asia/Manila')::date, CURRENT_DATE)
WHERE timekeeping_effective_date IS NULL;

-- High-performance composite indexes for real-time daily roster joins and monthly attendance audits
CREATE INDEX IF NOT EXISTS idx_employees_timekeeping_effective
ON public.employees(timekeeping_effective_date, status);

CREATE INDEX IF NOT EXISTS idx_attendances_emp_date
ON public.attendances(employee_id, date);

COMMIT;
