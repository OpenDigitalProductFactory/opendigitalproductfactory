--
-- PostgreSQL database dump
--

\restrict aYsUpYi386iegqV4aarjsuxapHIOZszRKfguyOPre57lChUzNaAk2XKoT6b06ij

-- Dumped from database version 16.13
-- Dumped by pg_dump version 17.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: DiscoveryRun; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."DiscoveryRun" VALUES ('cmmpy2i6i0001cnt4z9h5vzip', 'DISC-1773469699216', 'dpf_bootstrap', 'bootstrap', 'completed', '2026-03-14 06:28:19.723', '2026-03-14 06:28:19.71', 1, 0, NULL) ON CONFLICT DO NOTHING;


--
-- Data for Name: FeatureBuild; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."FeatureBuild" VALUES ('cmms2z61c000qge2ztkaqhlrr', 'FB-3A182513', 'I need to create a feature to register students that I train and pay me with the open group', NULL, NULL, NULL, NULL, 'ideate', NULL, NULL, NULL, NULL, NULL, NULL, 'cmmpxytua0000140lc0w39el6', '2026-03-15 18:21:14.448', '2026-03-15 18:21:14.448', NULL) ON CONFLICT DO NOTHING;


--
-- Data for Name: ModelProvider; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."ModelProvider" VALUES ('cmmqlxxi200046qrbei7ctb15', 'bedrock', 'AWS Bedrock', '["claude", "titan", "llama"]', 'unconfigured', '2026-03-15 14:59:06.395', 'Authorization', NULL, 'token', NULL, '[]', NULL, 3, 15, 'direct', NULL, 'api_key', '["api_key"]', 'https://console.aws.amazon.com/bedrock/', 'https://docs.aws.amazon.com/bedrock/', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxi400056qrbr0b2bsyq', 'ollama', 'Ollama (local)', '["llama3", "mistral", "phi3", "gemma2"]', 'inactive', '2026-03-15 14:59:06.399', NULL, 150, 'compute', 0.12, '["llama3", "mistral", "phi3", "gemma2", "qwen"]', NULL, NULL, NULL, 'direct', 'http://localhost:11434', 'none', '["none"]', NULL, 'https://github.com/ollama/ollama/blob/main/docs/api.md', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxij000b6qrbijpo5yft', 'together', 'Together AI', '["llama3", "mistral", "qwen"]', 'unconfigured', '2026-03-15 14:59:06.431', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.together.xyz/v1', 'api_key', '["api_key"]', 'https://api.together.ai/settings/billing', 'https://docs.together.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxil000c6qrbn1yzn8lu', 'fireworks', 'Fireworks AI', '["llama3", "mixtral", "qwen"]', 'unconfigured', '2026-03-15 14:59:06.437', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.fireworks.ai/inference/v1', 'api_key', '["api_key"]', 'https://fireworks.ai/account/billing', 'https://docs.fireworks.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxi700066qrbky6xnmr2', 'xai', 'xAI (Grok)', '["grok-2", "grok-3"]', 'active', '2026-03-15 15:33:28.791', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.x.ai/v1', 'api_key', '["api_key"]', 'https://console.x.ai', 'https://docs.x.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxin000d6qrbi5p1hjdf', 'openrouter', 'OpenRouter', '["multi-provider"]', 'unconfigured', '2026-03-15 14:59:06.442', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'router', 'https://openrouter.ai/api/v1', 'api_key', '["api_key"]', 'https://openrouter.ai/credits', 'https://openrouter.ai/docs', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxhz00036qrbaqypu4gd', 'gemini', 'Google Gemini', '["gemini-1.5-pro", "gemini-2.0"]', 'active', '2026-03-15 19:57:21.551', 'x-goog-api-key', NULL, 'token', NULL, '[]', NULL, 1.25, 5, 'direct', 'https://generativelanguage.googleapis.com/v1beta', 'api_key', '["api_key"]', 'https://aistudio.google.com/apikey', 'https://ai.google.dev/docs', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxi900076qrbcrxtybmu', 'mistral', 'Mistral AI', '["mistral-large", "mistral-small", "codestral"]', 'unconfigured', '2026-03-15 14:59:06.411', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.mistral.ai/v1', 'api_key', '["api_key"]', 'https://console.mistral.ai/billing', 'https://docs.mistral.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxic00086qrb7m0lqxg5', 'cohere', 'Cohere', '["command-r-plus", "command-r", "embed"]', 'unconfigured', '2026-03-15 14:59:06.415', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.cohere.com/v2', 'api_key', '["api_key"]', 'https://dashboard.cohere.com/billing', 'https://docs.cohere.com', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxho00006qrb411czdpe', 'anthropic', 'Anthropic', '["claude-3-5", "claude-4"]', 'unconfigured', '2026-03-15 14:59:06.371', 'x-api-key', NULL, 'token', NULL, '[]', NULL, 3, 15, 'direct', 'https://api.anthropic.com/v1', 'api_key', '["api_key"]', 'https://console.anthropic.com/settings/billing', 'https://docs.anthropic.com', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxhu00016qrbscqguyej', 'openai', 'OpenAI', '["gpt-4o", "gpt-4-turbo", "gpt-4o-mini"]', 'inactive', '2026-03-15 21:06:24.35', 'Authorization', NULL, 'token', NULL, '[]', NULL, 2.5, 10, 'direct', 'https://api.openai.com/v1', 'api_key', '["api_key"]', 'https://platform.openai.com/settings/organization/billing', 'https://platform.openai.com/docs', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxiq000e6qrb8kej2nnt', 'litellm', 'LiteLLM', '["multi-provider"]', 'unconfigured', '2026-03-15 14:59:06.446', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'router', NULL, 'api_key', '["api_key"]', NULL, 'https://docs.litellm.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxis000f6qrb7kt7e6ph', 'portkey', 'Portkey', '["multi-provider"]', 'unconfigured', '2026-03-15 14:59:06.451', 'x-portkey-api-key', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'router', 'https://api.portkey.ai/v1', 'api_key', '["api_key"]', 'https://app.portkey.ai/organisation/billing', 'https://docs.portkey.ai', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxhx00026qrbo3i2ohc7', 'azure-openai', 'Azure OpenAI', '["gpt-4o", "gpt-4-turbo"]', 'unconfigured', '2026-03-15 14:59:06.385', 'api-key', NULL, 'token', NULL, '[]', NULL, 5, 15, 'direct', NULL, 'api_key', '["api_key", "oauth2_client_credentials"]', 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI', 'https://learn.microsoft.com/en-us/azure/ai-services/openai/', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxiu000g6qrb7pglxsmh', 'martian', 'Martian', '["multi-provider"]', 'unconfigured', '2026-03-15 14:59:06.455', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'router', 'https://api.withmartian.com/v1', 'api_key', '["api_key"]', 'https://app.withmartian.com/billing', 'https://docs.withmartian.com', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxie00096qrbonlqgcd9', 'deepseek', 'DeepSeek', '["deepseek-chat", "deepseek-coder"]', 'unconfigured', '2026-03-15 14:59:06.421', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.deepseek.com', 'api_key', '["api_key"]', 'https://platform.deepseek.com/top_up', 'https://platform.deepseek.com/api-docs', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public."ModelProvider" VALUES ('cmmqlxxih000a6qrbqd8vxaua', 'groq', 'Groq', '["llama3", "mixtral", "gemma"]', 'unconfigured', '2026-03-15 14:59:06.426', 'Authorization', NULL, 'token', NULL, '[]', NULL, NULL, NULL, 'direct', 'https://api.groq.com/openai/v1', 'api_key', '["api_key"]', 'https://console.groq.com/settings/billing', 'https://console.groq.com/docs', NULL, NULL) ON CONFLICT DO NOTHING;


--
-- Data for Name: PlatformConfig; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."PlatformConfig" VALUES ('cmmqly8jv0002d6i1ttnfgwv2', 'provider_priority', '[{"rank": 1, "modelId": "deep-research-pro-preview-12-2025", "providerId": "gemini", "capabilityTier": "deep-thinker"}, {"rank": 2, "modelId": "grok-4-0709", "providerId": "xai", "capabilityTier": "deep-thinker"}]', '2026-03-15 17:43:06.827') ON CONFLICT DO NOTHING;
INSERT INTO public."PlatformConfig" VALUES ('cmms2w13k000kge2z3fkst9mq', 'brave_search_api_key', '"BSAOa9wFpVIhlfVXNBkvDuLZognuwoo"', '2026-03-15 18:18:48.08') ON CONFLICT DO NOTHING;


--
-- PostgreSQL database dump complete
--

\unrestrict aYsUpYi386iegqV4aarjsuxapHIOZszRKfguyOPre57lChUzNaAk2XKoT6b06ij

