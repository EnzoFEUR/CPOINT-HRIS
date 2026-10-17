-- Review-only offline receipts. This migration never writes canonical attendances.
BEGIN;
DO $$
BEGIN
    IF to_regclass('public.attendances') IS NULL OR to_regclass('public.employees') IS NULL OR to_regclass('public.payrolls') IS NULL THEN
        RAISE EXCEPTION 'Offline attendance requires the existing employee, attendance and payroll schema';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES ('id','uuid'),('employee_id','uuid'),('date','date'),('time_in','timestamp with time zone'),('time_out','timestamp with time zone')) required(column_name,data_type)
        LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name='attendances' AND c.column_name=required.column_name
        WHERE c.data_type IS DISTINCT FROM required.data_type
    ) OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendances' AND column_name='status') THEN
        RAISE EXCEPTION 'Offline attendance schema preflight failed; inspect deployed attendance metadata before rollout';
    END IF;
END $$;

CREATE TABLE public.offline_attendance_devices (
    id uuid PRIMARY KEY,
    operator_id uuid NOT NULL REFERENCES public.employees(id),
    company_scope text NOT NULL CHECK (length(company_scope) BETWEEN 1 AND 200),
    site_id text NOT NULL CHECK (length(site_id) BETWEEN 1 AND 200),
    public_key jsonb NOT NULL CHECK (public_key->>'kty'='EC' AND public_key->>'crv'='P-256' AND NOT public_key ? 'd'),
    enrolled_by uuid NOT NULL REFERENCES public.employees(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    authorized_at timestamptz NOT NULL DEFAULT now(),
    authorized_by uuid NOT NULL REFERENCES public.employees(id),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES public.employees(id),
    CHECK (expires_at > authorized_at AND expires_at <= authorized_at + interval '72 hours'),
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE TABLE public.offline_attendance_rosters (
    version uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES public.offline_attendance_devices(id),
    generated_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    employee_ids uuid[] NOT NULL,
    CHECK (expires_at > generated_at AND expires_at <= generated_at + interval '72 hours')
);
CREATE TABLE public.offline_attendance_events (
    event_id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES public.offline_attendance_devices(id),
    employee_id uuid NOT NULL REFERENCES public.employees(id),
    company_scope text NOT NULL,
    site_id text NOT NULL,
    roster_snapshot_version uuid NOT NULL REFERENCES public.offline_attendance_rosters(version),
    local_sequence bigint NOT NULL CHECK(local_sequence > 0),
    payload jsonb NOT NULL,
    signature text NOT NULL,
    payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
    received_by uuid NOT NULL REFERENCES public.employees(id),
    received_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','needs_verification','rejected')),
    UNIQUE(device_id,local_sequence)
);
CREATE INDEX offline_attendance_review_queue ON public.offline_attendance_events(company_scope,site_id,status,received_at);
CREATE TABLE public.offline_attendance_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.offline_attendance_events(event_id),
    actor_id uuid NOT NULL REFERENCES public.employees(id),
    decision text NOT NULL CHECK(decision IN ('reject','needs_verification')),
    reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.offline_attendance_device_authorizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES public.offline_attendance_devices(id),
    actor_id uuid NOT NULL REFERENCES public.employees(id),
    action text NOT NULL CHECK(action IN ('enrolled','renewed','revoked')),
    prior_expires_at timestamptz,
    expires_at timestamptz NOT NULL,
    prior_revoked_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.offline_attendance_audit_device() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.authorized_by IS NULL THEN NEW.authorized_by:=NEW.enrolled_by; END IF;
        IF NEW.authorized_by IS DISTINCT FROM NEW.enrolled_by THEN RAISE EXCEPTION 'Invalid initial offline device authorization'; END IF;
        actor:=NEW.enrolled_by;
    ELSE
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
          OR NEW.company_scope IS DISTINCT FROM OLD.company_scope OR NEW.site_id IS DISTINCT FROM OLD.site_id
          OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.enrolled_by IS DISTINCT FROM OLD.enrolled_by
          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Offline device identity is immutable; enroll a new device'; END IF;
        IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'OFFLINE_DEVICE_REVOKED'; END IF;
        IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by THEN
            IF NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
              OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by THEN
                RAISE EXCEPTION 'Invalid offline device revocation';
            END IF;
            actor:=NEW.revoked_by;
        ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by THEN
            IF NEW.authorized_at IS NULL OR NEW.authorized_by IS NULL OR NEW.authorized_at < OLD.authorized_at THEN RAISE EXCEPTION 'Invalid offline device authorization'; END IF;
            actor:=NEW.authorized_by;
        ELSE RETURN NEW;
        END IF;
    END IF;
    IF NOT public.offline_attendance_actor_is_manager(actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION public.offline_attendance_record_device_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        INSERT INTO public.offline_attendance_device_authorizations(device_id,actor_id,action,expires_at,revoked_at)
          VALUES(NEW.id,NEW.enrolled_by,'enrolled',NEW.expires_at,NEW.revoked_at);
    ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        INSERT INTO public.offline_attendance_device_authorizations(device_id,actor_id,action,prior_expires_at,expires_at,prior_revoked_at,revoked_at)
          VALUES(NEW.id,NEW.revoked_by,'revoked',OLD.expires_at,NEW.expires_at,OLD.revoked_at,NEW.revoked_at);
    ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by THEN
        INSERT INTO public.offline_attendance_device_authorizations(device_id,actor_id,action,prior_expires_at,expires_at,prior_revoked_at,revoked_at)
          VALUES(NEW.id,NEW.authorized_by,'renewed',OLD.expires_at,NEW.expires_at,OLD.revoked_at,NEW.revoked_at);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER offline_device_identity_guard BEFORE INSERT OR UPDATE ON public.offline_attendance_devices FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_audit_device();
CREATE TRIGGER offline_device_authorization_audit AFTER INSERT OR UPDATE ON public.offline_attendance_devices FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_record_device_authorization();

CREATE FUNCTION public.offline_attendance_actor_is_manager(p_actor_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_actor_id AND lower(e.role::text) IN ('admin','hr','superadmin')
      AND coalesce(to_jsonb(e)->>'is_active','true') <> 'false' AND to_jsonb(e)->>'archived_at' IS NULL
      AND lower(coalesce(e.status::text,'')) NOT IN ('inactive','suspended','terminated','resigned','separated'))
$$;

CREATE FUNCTION public.receive_offline_attendance_event(p_actor_id uuid,p_payload jsonb,p_signature text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.offline_attendance_devices%ROWTYPE; r public.offline_attendance_rosters%ROWTYPE;
    prior public.offline_attendance_events%ROWTYPE; v_event_id uuid; v_employee_id uuid; captured timestamptz;
BEGIN
    v_event_id := (p_payload->>'event_id')::uuid;
    v_employee_id := (p_payload->>'employee_id')::uuid;
    SELECT * INTO d FROM public.offline_attendance_devices WHERE id=(p_payload->>'device_id')::uuid FOR UPDATE;
    IF NOT FOUND OR d.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'OFFLINE_DEVICE_REVOKED'; END IF;
    IF NOT public.offline_attendance_actor_is_manager(p_actor_id) AND NOT EXISTS (
        SELECT 1 FROM public.employees e WHERE e.id=p_actor_id AND e.id=d.operator_id
          AND coalesce(to_jsonb(e)->>'is_active','true') <> 'false' AND to_jsonb(e)->>'archived_at' IS NULL
          AND lower(coalesce(e.status::text,'')) NOT IN ('inactive','suspended','terminated','resigned','separated')
    ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO prior FROM public.offline_attendance_events WHERE event_id=v_event_id;
    IF FOUND THEN
        IF prior.payload_hash IS DISTINCT FROM p_hash OR prior.payload IS DISTINCT FROM p_payload OR prior.device_id <> d.id THEN RAISE EXCEPTION 'OFFLINE_EVENT_TAMPERED'; END IF;
        RETURN jsonb_build_object('event_id',prior.event_id,'status',prior.status,'replayed',true,'received_at',prior.received_at,'reason_code','OFFLINE_BADGE_REQUIRES_REVIEW');
    END IF;
    SELECT * INTO r FROM public.offline_attendance_rosters WHERE version=(p_payload->>'roster_snapshot_version')::uuid AND device_id=d.id;
    IF NOT FOUND OR NOT v_employee_id=ANY(r.employee_ids) OR p_payload->>'company_scope' IS DISTINCT FROM d.company_scope
      OR p_payload->>'site_id' IS DISTINCT FROM d.site_id THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
    captured := (p_payload->>'captured_at')::timestamptz;
    IF p_payload->>'capture_method' IS DISTINCT FROM 'offline_badge' OR p_payload->>'event_schema_version' IS DISTINCT FROM '1'
      OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('TIME_IN','TIME_OUT') OR (p_payload->>'local_sequence')::bigint <= 0
      OR (p_payload->>'server_time_anchor')::timestamptz IS DISTINCT FROM r.generated_at
      OR captured < r.generated_at-interval '1 minute' OR captured > least(r.expires_at,d.expires_at) OR captured > now()+interval '1 minute'
      OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_signature IS NULL THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
    INSERT INTO public.offline_attendance_events(event_id,device_id,employee_id,company_scope,site_id,roster_snapshot_version,local_sequence,payload,signature,payload_hash,received_by)
      VALUES(v_event_id,d.id,v_employee_id,d.company_scope,d.site_id,r.version,(p_payload->>'local_sequence')::bigint,p_payload,p_signature,p_hash,p_actor_id);
    SELECT * INTO prior FROM public.offline_attendance_events WHERE event_id=v_event_id;
    RETURN jsonb_build_object('event_id',v_event_id,'status','needs_review','replayed',false,'received_at',prior.received_at,'reason_code','OFFLINE_BADGE_REQUIRES_REVIEW');
END $$;

CREATE FUNCTION public.decide_offline_attendance_event(p_actor_id uuid,p_event_id uuid,p_decision text,p_reason text,p_company_scope text,p_site_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.offline_attendance_events%ROWTYPE; next_status text;
BEGIN
    IF NOT public.offline_attendance_actor_is_manager(p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_decision='approve' THEN RAISE EXCEPTION 'OFFLINE_APPROVAL_NOT_RELEASED'; END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('reject','needs_verification') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 1000
      OR p_company_scope IS NULL OR p_site_ids IS NULL OR cardinality(p_site_ids)=0 THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
    SELECT * INTO receipt FROM public.offline_attendance_events WHERE event_id=p_event_id FOR UPDATE;
    IF NOT FOUND OR receipt.company_scope IS DISTINCT FROM p_company_scope OR NOT receipt.site_id=ANY(p_site_ids) THEN RAISE EXCEPTION 'OFFLINE_SCOPE_DENIED'; END IF;
    next_status := CASE p_decision WHEN 'reject' THEN 'rejected' ELSE 'needs_verification' END;
    IF receipt.status=next_status AND EXISTS(SELECT 1 FROM public.offline_attendance_decisions WHERE event_id=p_event_id AND actor_id=p_actor_id AND decision=p_decision AND reason=trim(p_reason)) THEN
        RETURN jsonb_build_object('event_id',p_event_id,'status',receipt.status,'replayed',true);
    END IF;
    IF receipt.status='rejected' THEN
        RAISE EXCEPTION 'OFFLINE_EVENT_ALREADY_DECIDED';
    END IF;
    INSERT INTO public.offline_attendance_decisions(event_id,actor_id,decision,reason) VALUES(p_event_id,p_actor_id,p_decision,trim(p_reason));
    UPDATE public.offline_attendance_events SET status=next_status WHERE event_id=p_event_id;
    RETURN jsonb_build_object('event_id',p_event_id,'status',next_status);
END $$;

CREATE FUNCTION public.offline_attendance_preserve_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Offline evidence cannot be deleted'; END IF;
    IF TG_TABLE_NAME IN ('offline_attendance_decisions','offline_attendance_device_authorizations') OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
        RAISE EXCEPTION 'Offline evidence is immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER offline_event_immutable BEFORE UPDATE OR DELETE ON public.offline_attendance_events FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_preserve_facts();
CREATE TRIGGER offline_decision_immutable BEFORE UPDATE OR DELETE ON public.offline_attendance_decisions FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_preserve_facts();
CREATE TRIGGER offline_device_authorization_immutable BEFORE UPDATE OR DELETE ON public.offline_attendance_device_authorizations FOR EACH ROW EXECUTE FUNCTION public.offline_attendance_preserve_facts();
ALTER TABLE public.offline_attendance_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_attendance_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_attendance_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_attendance_device_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_attendance_devices,public.offline_attendance_rosters,public.offline_attendance_events,public.offline_attendance_decisions,public.offline_attendance_device_authorizations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.offline_attendance_devices TO service_role;
GRANT SELECT,INSERT ON public.offline_attendance_rosters TO service_role;
GRANT SELECT ON public.offline_attendance_events,public.offline_attendance_decisions,public.offline_attendance_device_authorizations TO service_role;
REVOKE ALL ON FUNCTION public.offline_attendance_actor_is_manager(uuid),public.receive_offline_attendance_event(uuid,jsonb,text,text),public.decide_offline_attendance_event(uuid,uuid,text,text,text,text[]),public.offline_attendance_preserve_facts(),public.offline_attendance_audit_device(),public.offline_attendance_record_device_authorization() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.receive_offline_attendance_event(uuid,jsonb,text,text),public.decide_offline_attendance_event(uuid,uuid,text,text,text,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
