-- Additive approval and payroll concurrency protection. Apply after the base offline migration.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.post_payroll_with_sil(uuid,uuid,jsonb,uuid[],text,jsonb)') IS NULL
    OR to_regclass('public.offline_attendance_events') IS NULL OR to_regclass('public.leave_requests') IS NULL THEN
    RAISE EXCEPTION 'Install the offline receipt and current SIL payroll migrations before offline approval';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('id','uuid'),('employee_id','uuid'),('date','date'),('time_in','timestamp with time zone'),('time_out','timestamp with time zone')) expected(name,type)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='attendances' AND c.column_name=expected.name AND c.data_type=expected.type)) THEN
    RAISE EXCEPTION 'Unsupported attendance schema: review before installing offline approval';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendances' AND column_name='status' AND data_type IN ('text','character varying')) THEN RAISE EXCEPTION 'Unsupported attendance status type'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid='public.attendances'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=2 AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey))=ARRAY['date','employee_id']) THEN RAISE EXCEPTION 'Attendance requires employee/date uniqueness before approval'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES ('id','uuid'),('employee_id','uuid'),('period_start','date'),('period_end','date')) expected(name,type) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payrolls' AND column_name=expected.name AND data_type=expected.type)) THEN RAISE EXCEPTION 'Unsupported payroll schema: review before offline approval'; END IF;
END $$;

CREATE TABLE public.offline_attendance_versions (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id), version bigint NOT NULL CHECK(version>0)
);
CREATE TABLE public.offline_attendance_approvals (
  event_id uuid PRIMARY KEY REFERENCES public.offline_attendance_events(event_id),
  attendance_id uuid NOT NULL REFERENCES public.attendances(id),
  actor_id uuid NOT NULL REFERENCES public.employees(id),
  work_date date NOT NULL, action text NOT NULL CHECK(action IN ('TIME_IN','TIME_OUT')),
  captured_at timestamptz NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  before_values jsonb NOT NULL, after_values jsonb NOT NULL, policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payrolls ADD COLUMN offline_attendance_version bigint CHECK(offline_attendance_version>=0);
ALTER TABLE public.offline_attendance_events DROP CONSTRAINT offline_attendance_events_status_check;
ALTER TABLE public.offline_attendance_events ADD CONSTRAINT offline_attendance_events_status_check CHECK(status IN ('needs_review','needs_verification','rejected','synced'));
ALTER TABLE public.offline_attendance_decisions DROP CONSTRAINT offline_attendance_decisions_decision_check;
ALTER TABLE public.offline_attendance_decisions ADD CONSTRAINT offline_attendance_decisions_decision_check CHECK(decision IN ('reject','needs_verification','approve'));

CREATE OR REPLACE FUNCTION public.decide_offline_attendance_event(p_actor_id uuid,p_event_id uuid,p_decision text,p_reason text,p_company_scope text,p_site_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.offline_attendance_events%ROWTYPE; next_status text;
BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_decision='approve' THEN RAISE EXCEPTION 'Use the offline attendance approval transaction'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('reject','needs_verification') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 1000 OR p_company_scope IS NULL OR coalesce(cardinality(p_site_ids),0)=0 THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  SELECT * INTO receipt FROM public.offline_attendance_events WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR receipt.company_scope IS DISTINCT FROM p_company_scope OR NOT receipt.site_id=ANY(p_site_ids) THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  next_status:=CASE p_decision WHEN 'reject' THEN 'rejected' ELSE 'needs_verification' END;
  IF receipt.status=next_status AND EXISTS(SELECT 1 FROM public.offline_attendance_decisions WHERE event_id=p_event_id AND actor_id=p_actor_id AND decision=p_decision AND reason=trim(p_reason)) THEN RETURN jsonb_build_object('event_id',p_event_id,'status',receipt.status,'replayed',true); END IF;
  IF receipt.status IN ('rejected','synced') THEN RAISE EXCEPTION 'OFFLINE_EVENT_ALREADY_DECIDED'; END IF;
  INSERT INTO public.offline_attendance_decisions(event_id,actor_id,decision,reason) VALUES(p_event_id,p_actor_id,p_decision,trim(p_reason));
  UPDATE public.offline_attendance_events SET status=next_status WHERE event_id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'status',next_status);
END $$;

CREATE FUNCTION public.offline_attendance_approval_ready(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN jsonb_build_object('available',true,'version',1);
END $$;

CREATE FUNCTION public.offline_attendance_payroll_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_version bigint; expected_version bigint;
BEGIN
  PERFORM 1 FROM public.employees WHERE id=NEW.employee_id FOR UPDATE;
  SELECT version INTO current_version FROM public.offline_attendance_versions WHERE employee_id=NEW.employee_id;
  current_version:=coalesce(current_version,0);
  expected_version:=NEW.offline_attendance_version;
  IF expected_version IS NULL AND current_setting('app.offline_payroll_employee',true)=NEW.employee_id::text THEN
    expected_version:=nullif(current_setting('app.offline_payroll_version',true),'')::bigint;
  END IF;
  IF (current_version>0 OR expected_version IS NOT NULL) AND expected_version IS DISTINCT FROM current_version THEN
    RAISE EXCEPTION 'PAYROLL_ATTENDANCE_CHANGED';
  END IF;
  NEW.offline_attendance_version:=current_version;
  RETURN NEW;
END $$;
CREATE TRIGGER offline_attendance_payroll_guard BEFORE INSERT ON public.payrolls FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_payroll_guard();

CREATE FUNCTION public.offline_attendance_punch_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.offline_attendance_approvals WHERE attendance_id=OLD.id) AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.date IS DISTINCT FROM OLD.date) THEN RAISE EXCEPTION 'OFFLINE_APPROVED_PUNCH_LOCKED'; END IF;
  IF NEW.time_in IS DISTINCT FROM OLD.time_in AND EXISTS(SELECT 1 FROM public.offline_attendance_approvals WHERE attendance_id=OLD.id AND action='TIME_IN') THEN RAISE EXCEPTION 'OFFLINE_APPROVED_PUNCH_LOCKED'; END IF;
  IF NEW.time_out IS DISTINCT FROM OLD.time_out AND EXISTS(SELECT 1 FROM public.offline_attendance_approvals WHERE attendance_id=OLD.id AND action='TIME_OUT') THEN RAISE EXCEPTION 'OFFLINE_APPROVED_PUNCH_LOCKED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offline_attendance_punch_guard BEFORE UPDATE ON public.attendances FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_punch_guard();

-- Preserve the installed SIL calculation body; enforce the same revision check on its insert.
ALTER FUNCTION public.post_payroll_with_sil(uuid,uuid,jsonb,uuid[],text,jsonb) RENAME TO post_payroll_with_sil_before_offline_approval;
REVOKE ALL ON FUNCTION public.post_payroll_with_sil_before_offline_approval(uuid,uuid,jsonb,uuid[],text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.post_payroll_with_sil(p_actor_id uuid,p_employee_id uuid,p_payroll jsonb,p_payout_ids uuid[],p_frequency text,p_leave_signature jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_payroll->>'employee_id' IS DISTINCT FROM p_employee_id::text THEN RAISE EXCEPTION 'INVALID_CREDIT_COMMAND'; END IF;
  PERFORM 1 FROM public.employees WHERE id=p_employee_id FOR UPDATE;
  PERFORM set_config('app.offline_payroll_employee',p_employee_id::text,true);
  PERFORM set_config('app.offline_payroll_version',coalesce(p_payroll->>'offline_attendance_version',''),true);
  RETURN public.post_payroll_with_sil_before_offline_approval(p_actor_id,p_employee_id,p_payroll,p_payout_ids,p_frequency,p_leave_signature);
END $$;

CREATE FUNCTION public.approve_offline_attendance_event(p_actor_id uuid,p_event_id uuid,p_reason text,p_company_scope text,p_site_ids text[],p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.offline_attendance_events%ROWTYPE; prior public.offline_attendance_approvals%ROWTYPE;
  punch public.attendances%ROWTYPE; employee public.employees%ROWTYPE;
  captured timestamptz; work_day date; action text; matches integer; before_data jsonb;
  deadline timestamptz; attendance_status text; call_hour integer; call_minute integer; grace integer; rest_days jsonb;
BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 1000 OR p_company_scope IS NULL OR coalesce(cardinality(p_site_ids),0)=0 THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  SELECT * INTO receipt FROM public.offline_attendance_events WHERE event_id=p_event_id;
  IF NOT FOUND OR receipt.company_scope IS DISTINCT FROM p_company_scope OR NOT receipt.site_id=ANY(p_site_ids) THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  -- All approval and payroll writes lock the employee first, including the legacy insert path.
  SELECT * INTO employee FROM public.employees WHERE id=receipt.employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_EMPLOYEE_NOT_FOUND'; END IF;
  SELECT * INTO receipt FROM public.offline_attendance_events WHERE event_id=p_event_id FOR UPDATE;
  SELECT * INTO prior FROM public.offline_attendance_approvals WHERE event_id=p_event_id;
  IF FOUND THEN RETURN jsonb_build_object('event_id',p_event_id,'status','synced','attendance_reference',prior.attendance_id,'replayed',true); END IF;
  IF receipt.status NOT IN ('needs_review','needs_verification') THEN RAISE EXCEPTION 'OFFLINE_EVENT_ALREADY_DECIDED'; END IF;
  IF p_actor_id=receipt.employee_id THEN RAISE EXCEPTION 'OFFLINE_SELF_APPROVAL_DENIED'; END IF;
  IF coalesce(to_jsonb(employee)->>'is_active','true')='false' OR to_jsonb(employee)->>'archived_at' IS NOT NULL
    OR lower(coalesce(employee.status::text,'')) IN ('inactive','suspended','terminated','resigned','separated') THEN RAISE EXCEPTION 'OFFLINE_EMPLOYEE_INELIGIBLE'; END IF;
  captured:=(receipt.payload->>'captured_at')::timestamptz; action:=receipt.payload->>'action';
  IF captured IS NULL OR captured>now()+interval '1 minute' OR action IS NULL OR action NOT IN ('TIME_IN','TIME_OUT') THEN RAISE EXCEPTION 'OFFLINE_CLOCK_REVIEW_REQUIRED'; END IF;
  work_day:=(captured AT TIME ZONE 'Asia/Manila')::date;
  IF action='TIME_IN' THEN
    IF EXISTS(SELECT 1 FROM public.attendances WHERE employee_id=employee.id AND time_in IS NOT NULL AND time_out IS NULL) THEN RAISE EXCEPTION 'OFFLINE_OPEN_SHIFT_CONFLICT'; END IF;
    SELECT * INTO punch FROM public.attendances WHERE employee_id=employee.id AND date=work_day FOR UPDATE;
    IF FOUND AND (punch.time_in IS NOT NULL OR punch.time_out IS NOT NULL OR coalesce(punch.status::text,'Absent') NOT IN ('Absent','Awaiting Clock-in') OR to_jsonb(punch)->>'leave_credit_operation_id' IS NOT NULL) THEN RAISE EXCEPTION 'OFFLINE_ATTENDANCE_CONFLICT'; END IF;
  ELSE
    SELECT count(*) INTO matches FROM public.attendances WHERE employee_id=employee.id AND time_in IS NOT NULL AND time_out IS NULL AND time_in<captured AND captured<=time_in+interval '18 hours';
    IF matches<>1 THEN RAISE EXCEPTION 'OFFLINE_CLOCK_OUT_NEEDS_TIME_IN'; END IF;
    SELECT * INTO punch FROM public.attendances WHERE employee_id=employee.id AND time_in IS NOT NULL AND time_out IS NULL AND time_in<captured AND captured<=time_in+interval '18 hours' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_ATTENDANCE_CONFLICT'; END IF;
    work_day:=punch.date;
  END IF;
  IF EXISTS(SELECT 1 FROM public.payrolls WHERE employee_id=employee.id AND period_start<=work_day AND period_end>=work_day) THEN RAISE EXCEPTION 'OFFLINE_PAYROLL_ALREADY_SAVED'; END IF;
  IF EXISTS(SELECT 1 FROM public.leave_requests WHERE employee_id=employee.id AND status='Approved' AND start_date<=work_day AND end_date>=work_day) THEN RAISE EXCEPTION 'OFFLINE_APPROVED_LEAVE_CONFLICT'; END IF;
  before_data:=jsonb_build_object('id',punch.id,'time_in',punch.time_in,'time_out',punch.time_out,'status',punch.status);
  call_hour:=(p_policy->>'callTimeHour')::integer; call_minute:=(p_policy->>'callTimeMinute')::integer; grace:=(p_policy->>'gracePeriodMinutes')::integer;
  IF call_hour IS NULL OR call_hour NOT BETWEEN 0 AND 23 OR call_minute IS NULL OR call_minute NOT BETWEEN 0 AND 59 OR grace IS NULL OR grace NOT BETWEEN 0 AND 1440 THEN RAISE EXCEPTION 'OFFLINE_POLICY_INVALID'; END IF;
  rest_days:=coalesce(nullif(to_jsonb(employee)->'rest_days','null'::jsonb),'[0,6]'::jsonb);
  IF jsonb_typeof(rest_days)<>'array' OR jsonb_array_length(rest_days)>6 THEN RAISE EXCEPTION 'OFFLINE_POLICY_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(rest_days) day WHERE day !~ '^[0-6]$') THEN RAISE EXCEPTION 'OFFLINE_POLICY_INVALID'; END IF;
  deadline:=(work_day::timestamp+make_interval(hours=>call_hour,mins=>call_minute+grace)) AT TIME ZONE 'Asia/Manila';
  IF action='TIME_IN' THEN
    attendance_status:=CASE WHEN rest_days @> to_jsonb(ARRAY[extract(dow FROM work_day)::integer]) THEN 'Present' WHEN captured>=deadline+interval '1 minute' THEN 'Late' ELSE 'Present' END;
    IF punch.id IS NULL THEN
      INSERT INTO public.attendances(employee_id,date,time_in,status) VALUES(employee.id,work_day,captured,attendance_status) RETURNING * INTO punch;
    ELSE
      UPDATE public.attendances SET time_in=captured,status=attendance_status WHERE id=punch.id RETURNING * INTO punch;
    END IF;
    IF to_jsonb(punch) ? 'liveness_verified' THEN EXECUTE 'UPDATE public.attendances SET liveness_verified=false WHERE id=$1' USING punch.id; END IF;
  ELSE
    UPDATE public.attendances SET time_out=captured,status=CASE WHEN punch.status::text='Missed Punch' THEN CASE WHEN rest_days @> to_jsonb(ARRAY[extract(dow FROM work_day)::integer]) THEN 'Present' WHEN punch.time_in>=deadline+interval '1 minute' THEN 'Late' ELSE 'Present' END ELSE punch.status END WHERE id=punch.id RETURNING * INTO punch;
  END IF;
  INSERT INTO public.offline_attendance_approvals(event_id,attendance_id,actor_id,work_date,action,captured_at,reason,before_values,after_values,policy)
    VALUES(p_event_id,punch.id,p_actor_id,work_day,action,captured,trim(p_reason),before_data,jsonb_build_object('id',punch.id,'time_in',punch.time_in,'time_out',punch.time_out,'status',punch.status),p_policy);
  INSERT INTO public.offline_attendance_decisions(event_id,actor_id,decision,reason) VALUES(p_event_id,p_actor_id,'approve',trim(p_reason));
  INSERT INTO public.offline_attendance_versions(employee_id,version) VALUES(employee.id,1) ON CONFLICT(employee_id) DO UPDATE SET version=public.offline_attendance_versions.version+1;
  UPDATE public.offline_attendance_events SET status='synced' WHERE event_id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'status','synced','attendance_reference',punch.id,'replayed',false);
END $$;

CREATE FUNCTION public.offline_attendance_approval_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Offline approval history is immutable'; END $$;
CREATE TRIGGER offline_approval_immutable BEFORE UPDATE OR DELETE ON public.offline_attendance_approvals FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_approval_immutable();
ALTER TABLE public.offline_attendance_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_attendance_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_attendance_versions,public.offline_attendance_approvals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.offline_attendance_versions,public.offline_attendance_approvals TO service_role;
REVOKE ALL ON FUNCTION public.offline_attendance_approval_ready(uuid),public.offline_attendance_payroll_guard(),public.offline_attendance_punch_guard(),public.post_payroll_with_sil(uuid,uuid,jsonb,uuid[],text,jsonb),public.approve_offline_attendance_event(uuid,uuid,text,text,text[],jsonb),public.offline_attendance_approval_immutable() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.offline_attendance_approval_ready(uuid),public.post_payroll_with_sil(uuid,uuid,jsonb,uuid[],text,jsonb),public.approve_offline_attendance_event(uuid,uuid,text,text,text[],jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
