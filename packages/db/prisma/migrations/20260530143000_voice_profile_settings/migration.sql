-- Per-profile TTS tuning chosen by the user on the voice page (speed,
-- exaggeration/enthusiasm, cfgWeight/pacing, temperature/variation).
-- NULL = use the deployment/provider defaults, so existing profiles are
-- byte-identical until a user adjusts and saves.
ALTER TABLE "VoiceProfile" ADD COLUMN "voiceSettings" JSONB;
