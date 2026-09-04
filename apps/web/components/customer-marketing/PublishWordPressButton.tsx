"use client";

import { ExternalPublicationControl } from "./ExternalPublicationControl";

type Props = {
  draftId: string;
  channelConnected: boolean;
  fitBlocked?: boolean;
  artifactTitle?: string | null;
  audience?: string | null;
};

export function PublishWordPressButton(props: Props) {
  return (
    <ExternalPublicationControl
      {...props}
      connectHref="/platform/tools/integrations/wordpress"
      copy={{
        channelName: "WordPress",
        connectLabel: "Connect WordPress first",
        triggerLabel: "Create WordPress draft",
        confirmTitle: "Create this WordPress draft?",
        confirmLabel: "Yes, create WordPress draft",
        cancelLabel: "Keep in DPF",
        itemLabel: "Content",
        defaultAudience: "WordPress editors; the item will not be public",
        consequence: "This is saved as a WordPress draft and will not be public. Replaying an update changes the same WordPress item.",
        successLabel: "Draft created — open WordPress",
        disconnectedHelp: "Draft creation stays disabled until WordPress is connected.",
        blockedMessage: "Blocked: this content does not fit the business archetype. Reject it or fix the copy before creating a WordPress draft.",
      }}
      testIds={{
        blocked: "wordpress-publish-blocked-fit",
        confirmation: "wordpress-publish-preview",
        flash: "wordpress-publish-flash",
        success: "wordpress-publication-receipt",
      }}
    />
  );
}
