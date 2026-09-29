-- Phase 5: Hermes automation surfaces (leads, CV drafts)
-- Migration 005: automation_jobs table, leads, cv_drafts, helper RPCs

-- Claim automation job atomically (Hermes MCP tool)
CREATE OR REPLACE FUNCTION public.claim_automation_job(
  p_job_id UUID,
  p_claimed_by TEXT DEFAULT 'hermes'
)
RETURNS TABLE (
  success BOOLEAN,
  job_id UUID,
  job_type TEXT,
  payload JSONB,
  claimed_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row automation_jobs%ROWTYPE;
BEGIN
  -- Atomic read-and-claim
  SELECT * INTO v_row FROM automation_jobs
  WHERE id = p_job_id AND status = 'pending'
  FOR UPDATE;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT FALSE, p_job_id, NULL::TEXT, NULL::JSONB, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE automation_jobs
  SET status = 'claimed', claimed_at = now(), claimed_by = p_claimed_by
  WHERE id = p_job_id
  RETURNING id, job_type, payload, claimed_at
  INTO v_row.id, v_row.job_type, v_row.payload, v_row.claimed_at;

  RETURN QUERY SELECT TRUE, v_row.id, v_row.job_type, v_row.payload, v_row.claimed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_job(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_automation_job(UUID, TEXT) TO service_role;

-- Complete automation job (Hermes MCP tool)
CREATE OR REPLACE FUNCTION public.complete_automation_job(
  p_job_id UUID,
  p_result JSONB DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE automation_jobs
  SET status = 'done', result = p_result, finished_at = now()
  WHERE id = p_job_id AND status = 'claimed';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_automation_job(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_automation_job(UUID, JSONB) TO service_role;

-- Convert lead to candidate (Leads page "Convert" button, staff-initiated)
CREATE OR REPLACE FUNCTION public.convert_lead_to_candidate(
  p_lead_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  candidate_id UUID,
  message TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_candidate_id UUID;
BEGIN
  -- Fetch lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF v_lead IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Lead not found';
    RETURN;
  END IF;

  -- Check for duplicate candidate (same email/phone)
  IF v_lead.email IS NOT NULL THEN
    SELECT id INTO v_candidate_id FROM candidates WHERE email = v_lead.email LIMIT 1;
    IF v_candidate_id IS NOT NULL THEN
      RETURN QUERY SELECT FALSE, v_candidate_id, 'Candidate with this email already exists';
      RETURN;
    END IF;
  END IF;

  -- Create candidate
  INSERT INTO candidates (
    first_name, last_name, email, phone, country_interest,
    stage, source, notes, created_by
  ) VALUES (
    COALESCE(SPLIT_PART(v_lead.name, ' ', 1), 'Unknown'),
    COALESCE(NULLIF(TRIM(SUBSTRING(v_lead.name FROM POSITION(' ' IN v_lead.name) + 1)), ''), 'Prospect'),
    v_lead.email,
    v_lead.phone,
    v_lead.country_interest,
    'new',
    'lead:' || p_lead_id,
    'Converted from lead. Original notes: ' || COALESCE(v_lead.notes, '(none)'),
    auth.uid()
  ) RETURNING candidates.id INTO v_candidate_id;

  -- Mark lead as converted
  UPDATE leads SET status = 'converted', converted_candidate_id = v_candidate_id WHERE id = p_lead_id;

  RETURN QUERY SELECT TRUE, v_candidate_id, 'Successfully converted to candidate';
END;
$$;
REVOKE ALL ON FUNCTION public.convert_lead_to_candidate(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_candidate(UUID) TO authenticated;

-- Tables
CREATE TABLE IF NOT EXISTS automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
  result JSONB,
  requested_by UUID REFERENCES users_profiles(id) ON DELETE SET NULL,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read all jobs" ON automation_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert own jobs" ON automation_jobs FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid());

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  country_interest TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'enriching', 'qualified', 'converted', 'rejected')),
  notes TEXT,
  converted_candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email) WHERE email IS NOT NULL
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert leads" ON leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update own leads" ON leads FOR UPDATE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS cv_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  pdf_url TEXT,
  pdf_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  notes TEXT,
  reviewed_by UUID REFERENCES users_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cv_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read cv_drafts" ON cv_drafts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert cv_drafts" ON cv_drafts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update cv_drafts" ON cv_drafts FOR UPDATE TO authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status ON automation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_created_at ON automation_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cv_drafts_candidate_id ON cv_drafts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cv_drafts_status ON cv_drafts(status);

-- Update admin default page_set if not already present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users_profiles WHERE role = 'admin' AND page_set ? 'Leads') THEN
    UPDATE users_profiles
    SET page_set = COALESCE(page_set, '{}'::JSONB) || '{"Leads": true, "Reports": true}'::JSONB
    WHERE role = 'admin';
  END IF;
END $$;
