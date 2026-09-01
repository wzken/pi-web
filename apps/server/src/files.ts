import type { FastifyInstance } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import { isValidBase64 } from "@pi-web/protocol";
import { PiWebError, resolveAllowedDirectory, resolveContainedPath } from "@pi-web/shared";
import { z } from "zod";
import { SessiondClient } from "@pi-web/ipc";
import { saveAttachment } from "./attachments.js";
import { sendRawFile } from "./file-response.js";
import {
  authorizeSessionWorkspace,
  createWorkspaceEntry,
  listWorkspaceEntries,
  readWorkspaceText,
  renameWorkspaceEntry,
  validateWorkspaceEntryName
} from "./workspace-files.js";

export { saveAttachment, sanitizeAttachmentName } from "./attachments.js";
export {
  authorizeSessionWorkspace,
  authorizeWorkspace,
  createWorkspaceEntry,
  listWorkspaceEntries,
  readWorkspaceText,
  renameWorkspaceEntry,
  validateWorkspaceEntryName
} from "./workspace-files.js";

const maxAttachmentBytes = 16 * 1024 * 1024;
const attachmentSchema = z.object({
  mutationId: z.string().uuid().optional(),
  cwd: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(240),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((maxAttachmentBytes * 4) / 3) + 4)
    .refine(isValidBase64, "Attachment data must be valid padded base64")
});
const workspaceEntryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .transform(validateWorkspaceEntryName);
const createWorkspaceEntrySchema = z.object({
  path: z.string().max(4096).default(""),
  name: workspaceEntryNameSchema,
  directory: z.boolean().default(false)
});
const renameWorkspaceEntrySchema = z.object({
  path: z.string().min(1).max(4096),
  name: workspaceEntryNameSchema
});

export function registerFileRoutes(
  app: FastifyInstance,
  client: SessiondClient,
  getConfig: () => PiWebConfig
): void {
  app.post<{ Body: unknown }>("/api/attachments", async (request, reply) => {
    const input = attachmentSchema.parse(request.body);
    const data = Buffer.from(input.data, "base64");
    if (data.length > maxAttachmentBytes) {
      throw new PiWebError(
        "ATTACHMENT_TOO_LARGE",
        "Attachment is limited to 16 MB",
        413
      );
    }
    const config = getConfig();
    const cwd = await resolveAllowedDirectory(
      input.cwd,
      config.allowedRoots,
      config.allowAnyDirectory
    );
    return reply
      .code(201)
      .send(
        await saveAttachment(cwd, input.name, data, input.mutationId)
      );
  });

  app.get<{
    Params: { id: string };
    Querystring: { path?: string };
  }>("/api/sessions/:id/files", async (request) => {
    const session = await client.request("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    return await listWorkspaceEntries(cwd, request.query.path ?? "");
  });

  app.post<{
    Params: { id: string };
    Body: unknown;
  }>("/api/sessions/:id/file-entry", async (request, reply) => {
    const session = await client.request("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const input = createWorkspaceEntrySchema.parse(request.body);
    return reply.code(201).send(
      await createWorkspaceEntry(
        cwd,
        input.path,
        input.name,
        input.directory
      )
    );
  });

  app.put<{
    Params: { id: string };
    Body: unknown;
  }>("/api/sessions/:id/file-entry", async (request) => {
    const session = await client.request("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const input = renameWorkspaceEntrySchema.parse(request.body);
    return await renameWorkspaceEntry(cwd, input.path, input.name);
  });

  app.get<{
    Params: { id: string };
    Querystring: { path: string };
  }>("/api/sessions/:id/file-text", async (request) => {
    const session = await client.request("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    return await readWorkspaceText(cwd, request.query.path);
  });

  app.get<{
    Params: { id: string };
    Querystring: { path: string; download?: string };
  }>("/api/sessions/:id/file-raw", async (request, reply) => {
    const session = await client.request("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const target = await resolveContainedPath(cwd, request.query.path);
    await sendRawFile(request, reply, target, request.query.download === "1");
  });
}
