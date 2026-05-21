-- Migration: drop_voice_training_job
-- Chatterbox TTS uses zero-shot voice cloning — no training job required.
-- The VoiceTrainingJob table is replaced by storing a reference audio clip
-- directly on the dpf-tts volume. VoiceProfile.status transitions directly
-- to "ready" after reference audio upload.

DROP TABLE IF EXISTS "VoiceTrainingJob";
