-- Phase 4 accounts. FIRST invite both users from Supabase -> Authentication -> Users ->
-- "Invite user" (handle_new_user() creates their profile rows), THEN run this.
-- Public sign-ups must be OFF: Authentication -> Providers -> Email -> "Allow new users to sign up".
BEGIN;

-- Admin (the Boss's test admin account)
UPDATE public.users_profiles p
   SET role = 'admin',
       display_name = COALESCE(NULLIF(p.display_name, ''), 'Admin'),
       page_permissions = ARRAY['dashboard','candidates','pipeline','leads','jobs','appointments','tasks','documents','reports',
                                'settings','associates','cv-builder','job-generator','receptionist-view','recycle-bin','whatsapp']
  FROM auth.users u
 WHERE u.id = p.id AND lower(u.email) = 'salminabdalla93@gmail.com';

-- Staff (test staff account): the default staff page set, never admin
UPDATE public.users_profiles p
   SET role = 'user',
       display_name = COALESCE(NULLIF(p.display_name, ''), 'Staff'),
       page_permissions = ARRAY['dashboard','candidates','pipeline','leads','cv-builder','documents','associates','receptionist-view',
                                'tasks','appointments','jobs','job-generator','reports','whatsapp']
  FROM auth.users u
 WHERE u.id = p.id AND lower(u.email) = 'salminmoha09@gmail.com';

SELECT u.email, p.role, array_length(p.page_permissions, 1) AS pages
  FROM auth.users u JOIN public.users_profiles p ON p.id = u.id
 WHERE lower(u.email) IN ('salminabdalla93@gmail.com', 'salminmoha09@gmail.com');

COMMIT;
