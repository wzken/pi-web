import type { AuthRotateInput } from "@pi-web/protocol";
import { AuditStore } from "./audit-store.js";
import { NotificationStore } from "./notification-store.js";
import { SettingsStore } from "./settings-store.js";

export class AuthStore {
  constructor(
    private readonly transaction: (operation: () => void) => void,
    private readonly settings: SettingsStore,
    private readonly notifications: NotificationStore,
    private readonly audit: AuditStore
  ) {}

  rotateAccessKey(input: AuthRotateInput): void {
    this.transaction(() => {
      this.settings.set("access_key_hash", input.hash);
      this.settings.delete("auth_sessions");
      this.notifications.clearSubscriptions();
      this.audit.write(input.auditType, "success", input.actor);
    });
  }
}
