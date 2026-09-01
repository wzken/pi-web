import { z } from "zod";

export const authRotateSchema = z
  .object({
    hash: z
      .object({
        algorithm: z.literal("scrypt"),
        salt: z.string().min(1).max(512),
        hash: z.string().min(1).max(512)
      })
      .strict(),
    auditType: z.enum(["access_key.reset", "access_key.set"]),
    actor: z.enum(["web", "cli"])
  })
  .strict();
export type AuthRotateInput = z.infer<typeof authRotateSchema>;

export interface AuthRotateResult {
  updated: true;
}
