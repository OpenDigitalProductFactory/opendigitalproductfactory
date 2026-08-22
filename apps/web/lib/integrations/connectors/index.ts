import { createConnectorRegistry } from "../kernel/registry";
import { createEmailPostmarkConnectorAdapter } from "./email-postmark";
import { createMicrosoft365CommunicationsAdapter } from "./microsoft365-communications";
import { createWordPressConnectorAdapter } from "../wordpress/connector";

const emailPostmarkAdapter = createEmailPostmarkConnectorAdapter();
const microsoft365CommunicationsAdapter = createMicrosoft365CommunicationsAdapter();
const wordpressAdapter = createWordPressConnectorAdapter();

/** The sole composition root for production connector adapters. */
export const connectorRegistry = createConnectorRegistry([
  {
    definition: emailPostmarkAdapter.definition,
    adapter: emailPostmarkAdapter,
  },
  {
    definition: microsoft365CommunicationsAdapter.definition,
    adapter: microsoft365CommunicationsAdapter,
  },
  {
    definition: wordpressAdapter.definition,
    adapter: wordpressAdapter,
  },
]);
