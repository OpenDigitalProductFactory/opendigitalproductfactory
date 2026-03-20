import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";

/**
 * Listens for notification taps and navigates to the deep link
 * embedded in the notification payload (if present).
 */
export function useDeepLink() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const deepLink =
          response.notification.request.content.data?.deepLink;
        if (deepLink && typeof deepLink === "string") {
          router.push(deepLink as any);
        }
      },
    );
    return () => sub.remove();
  }, [router]);
}
