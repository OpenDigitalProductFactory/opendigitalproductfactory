// Compatibility entry point; both manual actions and durable recovery share
// the inference-owned probe, rather than the scheduler importing an action.
export { getLinkedActivationOptions, testProviderAuthInternal } from "@/lib/inference/provider-auth-test";
