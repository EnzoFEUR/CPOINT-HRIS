-- One complete-shift review; preserve the existing per-punch approval and payroll guards.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.approve_offline_attendance_event(uuid,uuid,text,text,text[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Install 202610140003_offline_attendance_approval.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.offline_attendance_pair_reviews (
  time_out_event_id uuid PRIMARY KEY REFERENCES public.offline_attendance_events(event_id),
  time_in_event_id uuid UNIQUE REFERENCES public.offline_attendance_events(event_id),
  actor_id uuid NOT NULL REFERENCES public.employees(id),
  decision text NOT NULL CHECK(decision IN ('approve','reject')),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  time_in timestamptz NOT NULL, time_out timestamptz NOT NULL,
  work_date date NOT NULL, attendance_id uuid REFERENCES public.attendances(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(time_out>time_in AND time_out<=time_in+interval '18 hours')
);
CREATE INDEX IF NOT EXISTS offline_attendance_pair_lookup ON public.offline_attendance_events(employee_id,company_scope,site_id);
ALTER TABLE public.offline_attendance_pair_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_attendance_pair_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.offline_attendance_pair_reviews TO service_role;
DROP TRIGGER IF EXISTS offline_pair_review_immutable ON public.offline_attendance_pair_reviews;
CREATE TRIGGER offline_pair_review_immutable BEFORE UPDATE OR DELETE ON public.offline_attendance_pair_reviews
  FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_approval_immutable();

CREATE OR REPLACE FUNCTION public.offline_attendance_pair_context(p_event_id uuid,p_company_scope text,p_site_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.offline_attendance_events%ROWTYPE; incoming public.offline_attendance_events%ROWTYPE;
  outgoing public.offline_attendance_events%ROWTYPE; prior public.offline_attendance_pair_reviews%ROWTYPE;
  canonical public.attendances%ROWTYPE; matches integer; matched_id uuid; in_at timestamptz; out_at timestamptz;
  work_day date; failure text; ids uuid[];
BEGIN
  SELECT * INTO target FROM public.offline_attendance_events WHERE event_id=p_event_id AND company_scope=p_company_scope AND site_id=ANY(p_site_ids);
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  SELECT * INTO prior FROM public.offline_attendance_pair_reviews WHERE time_out_event_id=p_event_id OR time_in_event_id=p_event_id;
  IF FOUND THEN
    IF EXISTS(SELECT 1 FROM public.offline_attendance_events WHERE event_id IN (prior.time_in_event_id,prior.time_out_event_id)
      AND (company_scope IS DISTINCT FROM p_company_scope OR NOT site_id=ANY(p_site_ids))) THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
    RETURN jsonb_build_object('review_event_id',prior.time_out_event_id,'time_in_event_id',prior.time_in_event_id,'time_out_event_id',prior.time_out_event_id,
      'event_ids',CASE WHEN prior.time_in_event_id IS NULL THEN ARRAY[prior.time_out_event_id] ELSE ARRAY[prior.time_in_event_id,prior.time_out_event_id] END,
      'time_in',prior.time_in,'time_out',prior.time_out,'work_date',prior.work_date,'complete',true,'can_approve',false,'can_reject',false,'issue',NULL);
  END IF;
  IF target.status='rejected' THEN failure:='Previously rejected capture';
  ELSIF target.payload->>'action'='TIME_IN' THEN
    incoming:=target; in_at:=(incoming.payload->>'captured_at')::timestamptz;
    IF incoming.status='synced' THEN SELECT t.* INTO canonical FROM public.offline_attendance_approvals a JOIN public.attendances t ON t.id=a.attendance_id WHERE a.event_id=incoming.event_id; END IF;
    SELECT count(*),(array_agg(e.event_id))[1] INTO matches,matched_id FROM public.offline_attendance_events e
      WHERE e.employee_id=target.employee_id AND e.company_scope=p_company_scope AND e.site_id=ANY(p_site_ids) AND e.status<>'rejected'
      AND e.payload->>'action'='TIME_OUT' AND (e.payload->>'captured_at')::timestamptz>in_at AND (e.payload->>'captured_at')::timestamptz<=in_at+interval '18 hours'
      AND (canonical.time_out IS NULL OR (e.payload->>'captured_at')::timestamptz=canonical.time_out)
      AND NOT EXISTS(SELECT 1 FROM public.attendances t WHERE t.employee_id=target.employee_id AND t.time_in>in_at AND t.time_in<(e.payload->>'captured_at')::timestamptz AND (t.time_out IS NULL OR t.time_out>=(e.payload->>'captured_at')::timestamptz));
    IF matches=0 THEN
      failure:=CASE WHEN incoming.status='synced' AND EXISTS(SELECT 1 FROM public.offline_attendance_approvals a JOIN public.attendances t ON t.id=a.attendance_id WHERE a.event_id=incoming.event_id AND t.time_out IS NOT NULL) THEN 'Already completed attendance' ELSE 'Missing Time Out' END;
    ELSIF matches<>1 THEN failure:='Conflicting punches';
    ELSE SELECT * INTO outgoing FROM public.offline_attendance_events WHERE event_id=matched_id; END IF;
  ELSIF target.payload->>'action'='TIME_OUT' THEN outgoing:=target;
  ELSE failure:='Invalid capture'; END IF;

  IF failure IS NULL THEN
    out_at:=(outgoing.payload->>'captured_at')::timestamptz;
    incoming:=NULL;
    SELECT count(*),(array_agg(e.event_id))[1] INTO matches,matched_id FROM public.offline_attendance_events e
      WHERE e.employee_id=target.employee_id AND e.company_scope=p_company_scope AND e.site_id=ANY(p_site_ids) AND e.status<>'rejected'
      AND e.payload->>'action'='TIME_IN' AND (e.payload->>'captured_at')::timestamptz<out_at AND (e.payload->>'captured_at')::timestamptz>=out_at-interval '18 hours'
      AND (e.status<>'synced' OR EXISTS(SELECT 1 FROM public.offline_attendance_approvals a JOIN public.attendances t ON t.id=a.attendance_id
        WHERE a.event_id=e.event_id AND t.employee_id=target.employee_id AND t.time_in=(e.payload->>'captured_at')::timestamptz
        AND (t.time_out IS NULL OR (outgoing.status='synced' AND t.time_out=out_at))));
    IF matches>1 THEN failure:='Conflicting punches';
    ELSIF matches=1 THEN
      SELECT * INTO incoming FROM public.offline_attendance_events WHERE event_id=matched_id;
      in_at:=(incoming.payload->>'captured_at')::timestamptz; work_day:=(in_at AT TIME ZONE 'Asia/Manila')::date;
    ELSE
      SELECT count(*),(array_agg(id))[1] INTO matches,matched_id FROM public.attendances
        WHERE employee_id=target.employee_id AND time_in<out_at AND out_at<=time_in+interval '18 hours'
        AND (time_out IS NULL OR (target.status='synced' AND time_out=out_at));
      IF matches=1 THEN SELECT * INTO canonical FROM public.attendances WHERE id=matched_id; in_at:=canonical.time_in; work_day:=canonical.date;
      ELSIF matches=0 THEN failure:='Missing Time In'; ELSE failure:='Conflicting punches'; END IF;
    END IF;
    IF target.payload->>'action'='TIME_IN' AND incoming.event_id IS DISTINCT FROM target.event_id THEN
      failure:=CASE WHEN target.status='synced' THEN 'Already completed attendance' ELSE 'Conflicting punches' END;
    END IF;
  END IF;
  IF failure IS NULL THEN
    SELECT count(*) INTO matches FROM public.offline_attendance_events WHERE employee_id=target.employee_id AND company_scope=p_company_scope
      AND site_id=ANY(p_site_ids) AND status<>'rejected' AND payload->>'action'='TIME_IN'
      AND ((payload->>'captured_at')::timestamptz AT TIME ZONE 'Asia/Manila')::date=work_day;
    IF matches>1 OR (incoming.event_id IS NULL AND matches>0) THEN failure:='Conflicting punches'; END IF;
    IF incoming.event_id IS NOT NULL THEN
      IF incoming.status='synced' THEN
        SELECT t.* INTO canonical FROM public.offline_attendance_approvals a JOIN public.attendances t ON t.id=a.attendance_id WHERE a.event_id=incoming.event_id;
        IF canonical.id IS NULL OR canonical.time_in IS DISTINCT FROM in_at THEN failure:='Conflicting punches';
        ELSIF canonical.time_out IS NULL THEN
          SELECT count(*) INTO matches FROM public.attendances WHERE employee_id=target.employee_id AND time_in<out_at AND time_out IS NULL AND out_at<=time_in+interval '18 hours';
          IF matches<>1 THEN failure:='Conflicting punches'; END IF;
        END IF;
      ELSE
        SELECT * INTO canonical FROM public.attendances WHERE employee_id=target.employee_id AND date=work_day;
        IF canonical.id IS NOT NULL AND (canonical.time_in IS NOT NULL OR canonical.time_out IS NOT NULL OR coalesce(canonical.status::text,'Absent') NOT IN ('Absent','Awaiting Clock-in') OR to_jsonb(canonical)->>'leave_credit_operation_id' IS NOT NULL) THEN failure:='Conflicting punches'; END IF;
        IF EXISTS(SELECT 1 FROM public.attendances WHERE employee_id=target.employee_id AND time_in IS NOT NULL AND time_out IS NULL) THEN failure:='Conflicting punches'; END IF;
      END IF;
    END IF;
    IF outgoing.status='synced' AND NOT EXISTS(SELECT 1 FROM public.offline_attendance_approvals WHERE event_id=outgoing.event_id AND offline_attendance_approvals.attendance_id=canonical.id) THEN failure:='Conflicting punches'; END IF;
    IF NOT coalesce(outgoing.status='synced' AND canonical.time_out=out_at,false) THEN
      SELECT count(*) INTO matches FROM public.offline_attendance_events e WHERE e.employee_id=target.employee_id AND e.company_scope=p_company_scope
        AND e.site_id=ANY(p_site_ids) AND e.status<>'rejected' AND e.payload->>'action'='TIME_OUT'
        AND (e.payload->>'captured_at')::timestamptz>in_at AND (e.payload->>'captured_at')::timestamptz<=in_at+interval '18 hours'
        AND NOT EXISTS(SELECT 1 FROM public.attendances t WHERE t.employee_id=target.employee_id AND t.time_in>in_at AND t.time_in<(e.payload->>'captured_at')::timestamptz AND (t.time_out IS NULL OR t.time_out>=(e.payload->>'captured_at')::timestamptz));
      IF matches<>1 THEN failure:='Conflicting punches'; END IF;
    END IF;
    IF outgoing.status='synced' AND incoming.status IN ('needs_review','needs_verification') THEN failure:='Conflicting punches'; END IF;
  END IF;
  IF failure IS NOT NULL THEN
    RETURN jsonb_build_object('review_event_id',p_event_id,'event_ids',ARRAY[p_event_id],'time_in',CASE WHEN target.payload->>'action'='TIME_IN' THEN (target.payload->>'captured_at')::timestamptz ELSE NULL END,
      'time_out',CASE WHEN target.payload->>'action'='TIME_OUT' THEN (target.payload->>'captured_at')::timestamptz ELSE NULL END,
      'complete',false,'can_approve',false,'can_reject',false,'issue',failure);
  END IF;
  ids:=CASE WHEN incoming.event_id IS NULL THEN ARRAY[outgoing.event_id] ELSE ARRAY[incoming.event_id,outgoing.event_id] END;
  RETURN jsonb_build_object('review_event_id',outgoing.event_id,'time_in_event_id',incoming.event_id,'time_out_event_id',outgoing.event_id,'event_ids',ids,
    'time_in',in_at,'time_out',out_at,'work_date',work_day,'attendance_reference',canonical.id,'complete',true,'issue',NULL,
    'can_approve',outgoing.status IN ('needs_review','needs_verification'),
    'can_reject',outgoing.status IN ('needs_review','needs_verification') AND (incoming.event_id IS NULL OR incoming.status IN ('needs_review','needs_verification')));
END $$;

CREATE OR REPLACE FUNCTION public.offline_attendance_review_pairs(p_actor_id uuid,p_event_ids uuid[],p_company_scope text,p_site_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE event_id uuid; result jsonb:='{}'; BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_event_ids IS NULL OR cardinality(p_event_ids)>250 OR p_company_scope IS NULL OR coalesce(cardinality(p_site_ids),0)=0 THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  FOREACH event_id IN ARRAY p_event_ids LOOP result:=result||jsonb_build_object(event_id::text,public.offline_attendance_pair_context(event_id,p_company_scope,p_site_ids)); END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.review_offline_attendance_pair(p_actor_id uuid,p_event_id uuid,p_decision text,p_reason text,p_company_scope text,p_site_ids text[],p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.offline_attendance_events%ROWTYPE; prior public.offline_attendance_pair_reviews%ROWTYPE; pair jsonb;
  in_id uuid; out_id uuid; reviewed_id uuid; ids uuid[]; result jsonb; attendance_id uuid; next_attendance_id uuid;
BEGIN
  IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_company_scope IS NULL OR coalesce(cardinality(p_site_ids),0)=0 THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  SELECT * INTO target FROM public.offline_attendance_events WHERE event_id=p_event_id AND company_scope=p_company_scope AND site_id=ANY(p_site_ids);
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
  IF p_actor_id=target.employee_id THEN RAISE EXCEPTION 'OFFLINE_SELF_APPROVAL_DENIED'; END IF;
  PERFORM 1 FROM public.employees WHERE id=target.employee_id FOR UPDATE;
  PERFORM 1 FROM public.offline_attendance_events WHERE employee_id=target.employee_id AND company_scope=p_company_scope AND site_id=ANY(p_site_ids)
    AND ((payload->>'captured_at')::timestamptz AT TIME ZONE 'Asia/Manila')::date
      BETWEEN ((target.payload->>'captured_at')::timestamptz AT TIME ZONE 'Asia/Manila')::date-1 AND ((target.payload->>'captured_at')::timestamptz AT TIME ZONE 'Asia/Manila')::date+1
    ORDER BY event_id FOR UPDATE;
  SELECT * INTO prior FROM public.offline_attendance_pair_reviews WHERE time_out_event_id=p_event_id OR time_in_event_id=p_event_id;
  IF FOUND THEN
    PERFORM public.offline_attendance_pair_context(p_event_id,p_company_scope,p_site_ids);
    IF prior.decision<>p_decision THEN RAISE EXCEPTION 'OFFLINE_EVENT_ALREADY_DECIDED'; END IF;
    RETURN jsonb_build_object('event_id',prior.time_out_event_id,'status',CASE p_decision WHEN 'approve' THEN 'synced' ELSE 'rejected' END,'attendance_reference',prior.attendance_id,'replayed',true);
  END IF;
  pair:=public.offline_attendance_pair_context(p_event_id,p_company_scope,p_site_ids);
  IF NOT coalesce((pair->>'complete')::boolean,false) THEN RAISE EXCEPTION 'OFFLINE_PAIR_INCOMPLETE'; END IF;
  in_id:=(pair->>'time_in_event_id')::uuid; out_id:=(pair->>'time_out_event_id')::uuid;
  IF p_decision='reject' AND NOT coalesce((pair->>'can_reject')::boolean,false) THEN RAISE EXCEPTION 'OFFLINE_EVENT_ALREADY_DECIDED'; END IF;
  ids:=CASE WHEN in_id IS NULL THEN ARRAY[out_id] ELSE ARRAY[in_id,out_id] END;
  FOREACH reviewed_id IN ARRAY ids LOOP
    IF p_decision='approve' THEN
      result:=public.approve_offline_attendance_event(p_actor_id,reviewed_id,trim(p_reason),p_company_scope,p_site_ids,p_policy);
      next_attendance_id:=(result->>'attendance_reference')::uuid;
      IF next_attendance_id IS NULL OR (attendance_id IS NOT NULL AND attendance_id<>next_attendance_id)
        OR (pair->>'attendance_reference' IS NOT NULL AND (pair->>'attendance_reference')::uuid<>next_attendance_id) THEN RAISE EXCEPTION 'OFFLINE_ATTENDANCE_CONFLICT'; END IF;
      attendance_id:=next_attendance_id;
    ELSE
      PERFORM public.decide_offline_attendance_event(p_actor_id,reviewed_id,'reject',trim(p_reason),p_company_scope,p_site_ids);
    END IF;
  END LOOP;
  INSERT INTO public.offline_attendance_pair_reviews(time_out_event_id,time_in_event_id,actor_id,decision,reason,time_in,time_out,work_date,attendance_id)
    VALUES(out_id,in_id,p_actor_id,p_decision,trim(p_reason),(pair->>'time_in')::timestamptz,(pair->>'time_out')::timestamptz,(pair->>'work_date')::date,attendance_id);
  RETURN jsonb_build_object('event_id',out_id,'event_ids',pair->'event_ids','status',CASE p_decision WHEN 'approve' THEN 'synced' ELSE 'rejected' END,'attendance_reference',attendance_id,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.offline_attendance_pair_context(uuid,text,text[]),public.offline_attendance_review_pairs(uuid,uuid[],text,text[]),public.review_offline_attendance_pair(uuid,uuid,text,text,text,text[],jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.offline_attendance_review_pairs(uuid,uuid[],text,text[]),public.review_offline_attendance_pair(uuid,uuid,text,text,text,text[],jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
