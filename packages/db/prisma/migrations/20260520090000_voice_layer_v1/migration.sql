-- Add voice fields to DecisionPerspectiveProfile
ALTER TABLE "DecisionPerspectiveProfile"
  ADD COLUMN "personaConfig" JSONB,
  ADD COLUMN "voiceEnabled"  BOOLEAN NOT NULL DEFAULT false;

-- Add voiceOutput relation to DecisionInteraction (FK added below via DecisionInteractionVoiceOutput)

-- VoiceConsentRecord
CREATE TABLE "VoiceConsentRecord" (
  "id"                    TEXT NOT NULL,
  "subjectName"           TEXT NOT NULL,
  "subjectEmail"          TEXT,
  "consentMethod"         TEXT NOT NULL,
  "authorizedUseCases"    TEXT[] NOT NULL DEFAULT '{}',
  "authorizedLanguages"   TEXT[] NOT NULL DEFAULT '{en}',
  "authorizedTerritories" TEXT[] NOT NULL DEFAULT '{global}',
  "expiresAt"             TIMESTAMP(3) NOT NULL,
  "capturedByPrincipalId" TEXT NOT NULL,
  "evidenceRef"           TEXT,
  "revokedAt"             TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VoiceConsentRecord_capturedByPrincipalId_idx"
  ON "VoiceConsentRecord"("capturedByPrincipalId");

-- VoiceProfile
CREATE TABLE "VoiceProfile" (
  "id"                    TEXT NOT NULL,
  "profileId"             TEXT NOT NULL,
  "provider"              TEXT NOT NULL,
  "providerVoiceId"       TEXT,
  "status"                TEXT NOT NULL DEFAULT 'pending',
  "consentType"           TEXT NOT NULL,
  "consentRecordId"       TEXT,
  "sampleCount"           INTEGER NOT NULL DEFAULT 0,
  "totalSampleDurationMs" INTEGER NOT NULL DEFAULT 0,
  "qualityScore"          DOUBLE PRECISION,
  "language"              TEXT NOT NULL DEFAULT 'en',
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VoiceProfile_profileId_key" ON "VoiceProfile"("profileId");
CREATE INDEX "VoiceProfile_status_idx" ON "VoiceProfile"("status");
ALTER TABLE "VoiceProfile"
  ADD CONSTRAINT "VoiceProfile_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "VoiceProfile_consentRecordId_fkey"
    FOREIGN KEY ("consentRecordId") REFERENCES "VoiceConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VoiceTrainingJob
CREATE TABLE "VoiceTrainingJob" (
  "id"             TEXT NOT NULL,
  "voiceProfileId" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "providerJobId"  TEXT,
  "inputSamples"   JSONB NOT NULL DEFAULT '[]',
  "errorMessage"   TEXT,
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceTrainingJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VoiceTrainingJob_voiceProfileId_status_idx"
  ON "VoiceTrainingJob"("voiceProfileId", "status");
ALTER TABLE "VoiceTrainingJob"
  ADD CONSTRAINT "VoiceTrainingJob_voiceProfileId_fkey"
    FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DecisionInteractionVoiceOutput
CREATE TABLE "DecisionInteractionVoiceOutput" (
  "id"              TEXT NOT NULL,
  "interactionId"   TEXT NOT NULL,
  "audioStorageKey" TEXT NOT NULL,
  "narrationText"   TEXT NOT NULL,
  "durationMs"      INTEGER NOT NULL,
  "provider"        TEXT NOT NULL,
  "voiceProfileId"  TEXT NOT NULL,
  "ttsCostUnits"    INTEGER,
  "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionInteractionVoiceOutput_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DecisionInteractionVoiceOutput_interactionId_key"
  ON "DecisionInteractionVoiceOutput"("interactionId");
CREATE INDEX "DecisionInteractionVoiceOutput_voiceProfileId_idx"
  ON "DecisionInteractionVoiceOutput"("voiceProfileId");
ALTER TABLE "DecisionInteractionVoiceOutput"
  ADD CONSTRAINT "DecisionInteractionVoiceOutput_interactionId_fkey"
    FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
