-- Phase 4 verification. Run in the Supabase SQL editor AFTER supabase-schema.sql and
-- migrations 001 -> 005. Every row must say ok = true. Read-only: changes nothing.
WITH expected_tables(name) AS (
  VALUES ('users_profiles'), ('candidates'), ('jobs'), ('appointments'), ('tasks'), ('documents'), ('cv_drafts'),
         ('automation_jobs'), ('whatsapp_templates'), ('activity_log'), ('leads')
), checks AS (
  -- 1. every expected table exists with RLS enabled
  SELECT 'rls: ' || e.name AS check_name, COALESCE(c.relrowsecurity, false) AS ok,
         CASE WHEN c.oid IS NULL THEN 'table missing' WHEN NOT c.relrowsecurity THEN 'RLS DISABLED' ELSE 'enabled' END AS detail
    FROM expected_tables e
    LEFT JOIN pg_class c ON c.relname = e.name AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  UNION ALL
  -- 2. no other public table without RLS
  SELECT 'rls: every other public table', count(*) = 0, COALESCE(string_agg(c.relname, ', '), 'none without RLS')
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  -- 3. no policy grants anything to anon / public
  SELECT 'no anon/public policies', count(*) = 0, COALESCE(string_agg(tablename || '.' || policyname, ', '), 'none')
    FROM pg_policies
   WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::name[])
  UNION ALL
  -- 4. documents bucket is private
  SELECT 'storage: documents bucket private', COALESCE(bool_and(NOT public), false), COALESCE(string_agg('public=' || public::text, ','), 'bucket missing')
    FROM storage.buckets WHERE id = 'documents'
  UNION ALL
  SELECT 'storage: no public read policy', count(*) = 0, COALESCE(string_agg(policyname, ', '), 'none')
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon', 'public']::name[])
  UNION ALL
  -- 5. security functions exist
  SELECT 'function: ' || f, EXISTS (SELECT 1 FROM pg_proc WHERE proname = f AND pronamespace = 'public'::regnamespace), 'SECURITY DEFINER / trigger'
    FROM unnest(ARRAY['is_admin', 'is_valid_stage_transition', 'enforce_stage_transition', 'guard_recycle_bin_restore',
                      'claim_automation_jobs', 'convert_lead_to_candidate', 'leads_client_guard', 'cv_drafts_client_guard']) AS f
  UNION ALL
  -- 6. claim_automation_jobs is NOT callable by browser roles
  SELECT 'claim_automation_jobs not executable by authenticated/anon',
         NOT has_function_privilege('authenticated', 'public.claim_automation_jobs(text, text[], integer)', 'EXECUTE')
         AND NOT has_function_privilege('anon', 'public.claim_automation_jobs(text, text[], integer)', 'EXECUTE'), 'service_role only'
  UNION ALL
  -- 7. stage CHECK constraint present
  SELECT 'candidates_stage_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_stage_check'), 'canonical stages only'
  UNION ALL
  -- 8. clean launch (CRM-9): no demo rows. Adjust if you have already started real work.
  SELECT 'clean launch: no demo emails', count(*) = 0, count(*) || ' candidate(s) with demo/example emails'
    FROM public.candidates WHERE email ILIKE '%@example.%' OR email ILIKE '%demo%'
  UNION ALL
  -- 9. accounts
  SELECT 'admin account salminabdalla93@gmail.com', EXISTS (
           SELECT 1 FROM auth.users u JOIN public.users_profiles p ON p.id = u.id
            WHERE lower(u.email) = 'salminabdalla93@gmail.com' AND p.role = 'admin'), 'role = admin'
  UNION ALL
  SELECT 'staff account salminmoha09@gmail.com', EXISTS (
           SELECT 1 FROM auth.users u JOIN public.users_profiles p ON p.id = u.id
            WHERE lower(u.email) = 'salminmoha09@gmail.com' AND p.role <> 'admin'), 'role = user (staff)'
)
SELECT check_name, ok, detail FROM checks ORDER BY ok, check_name;
