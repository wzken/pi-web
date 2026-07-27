import { useEffect, useState } from "react";
import {
  getUnreadSessionIds,
  notificationStateEvent
} from "./notifications";

export function useUnreadSessions(): Set<string> {
  const [unread, setUnread] = useState(getUnreadSessionIds);

  useEffect(() => {
    const refresh = () => setUnread(getUnreadSessionIds());
    window.addEventListener(notificationStateEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(notificationStateEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return unread;
}
