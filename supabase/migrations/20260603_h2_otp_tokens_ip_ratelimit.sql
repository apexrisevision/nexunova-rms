-- BATCH H2 (2026-06-03): support IP + global rate-limiting on the send-auth-otp edge function.
-- Adds a nullable ip_address column to otp_tokens (used ONLY by send-auth-otp/verify-auth-otp after the
-- SMS send-otp/verify-otp functions were deleted) + indexes for the sliding-window count queries.
-- Additive/backward-compatible: the old edge function simply leaves ip_address NULL.
ALTER TABLE public.otp_tokens ADD COLUMN IF NOT EXISTS ip_address text;
CREATE INDEX IF NOT EXISTS idx_otp_tokens_created    ON public.otp_tokens (created_at);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_ip_created ON public.otp_tokens (ip_address, created_at);
