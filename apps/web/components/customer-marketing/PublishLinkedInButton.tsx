"use client";

import { ExternalPublicationControl } from "./ExternalPublicationControl";
import {
  INTEGRATIONS_INDEX_HREF,
  integrationSettingsHrefForChannel,
} from "@/lib/tools/integration-settings-href";

type Props = {
  draftId: string;
  channelConnected: boolean;
  channelId: string;
  /** True when archetype-fit flags the body as off-archetype/software-platform content. */
  fitBlocked?: boolean;
  /** Owner-readable artifact title shown in the pre-publish confirmation. */
  artifactTitle?: string | null;
  /** Owner-readable audience description shown in the pre-publish confirmation. */
  audience?: string | null;
};

export function PublishLinkedInButton({
  draftId,
  channelConnected,
  channelId,
  fitBlocked,
  artifactTitle,
  audience,
}: Props) {
  return (
    <ExternalPublicationControl
      draftId={draftId}
      channelConnected={channelConnected}
      connectHref={integrationSettingsHrefForChannel(channelId) ?? INTEGRATIONS_INDEX_HREF}
      fitBlocked={fitBlocked}
      artifactTitle={artifactTitle}
      audience={audience}
      copy={{
        channelName: "LinkedIn",
        connectLabel: "Connect LinkedIn first",
        triggerLabel: "Publish to LinkedIn",
        confirmTitle: "Publish this post publicly?",
        confirmLabel: "Yes, publish to LinkedIn",
        cancelLabel: "Keep as draft",
        itemLabel: "Post",
        defaultAudience: "everyone who can see this business's LinkedIn presence",
        consequence: "This posts outside DPF. It can be deleted on LinkedIn later, but people may already have seen it.",
        successLabel: "Published — view post",
        disconnectedHelp: "Publish stays disabled until the integration is connected.",
        blockedMessage: "Blocked: this content does not fit the business archetype. Reject it or fix the copy before publishing.",
      }}
      testIds={{
        blocked: "publish-blocked-fit",
        confirmation: "publish-confirm-panel",
        flash: "publish-flash",
        success: "publish-success-link",
      }}
    />
  );
}
