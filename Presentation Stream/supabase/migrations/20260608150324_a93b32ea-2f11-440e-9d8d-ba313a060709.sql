
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_email_allowed(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;

-- Storage policies for the private 'presenter-files' bucket
-- Files are stored under <user_id>/...
CREATE POLICY "Users read own presenter files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'presenter-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own presenter files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'presenter-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own presenter files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'presenter-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own presenter files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'presenter-files' AND auth.uid()::text = (storage.foldername(name))[1]);
