import { z } from "zod";
import { thinkingLevels } from "./common.js";

export const settingsUpdateSchema = z.object({
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1).max(32).optional(),
  allowAnyDirectory: z.boolean().optional(),
  defaultTimezone: z.string().min(1).max(100).optional(),
  defaultCronTimeoutSeconds: z.number().int().min(1).max(86_400).optional(),
  minimumCronIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  modelSchedulePolicy: z.enum(["allow", "create_disabled", "deny"]).optional(),
  piExecutable: z.string().min(1).max(4096).optional(),
  cookieSecure: z.enum(["auto", "always", "never"]).optional(),
  defaultModel: z.string().max(300).nullable().optional(),
  defaultThinkingLevel: z.enum(thinkingLevels).nullable().optional(),
  defaultSystemPrompt: z.string().max(100_000).nullable().optional()
});
