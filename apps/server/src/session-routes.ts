import type { FastifyInstance } from "fastify";
import {
  createSessionSchema,
  promptSchema,
  resumeSessionSchema,
  sessionFolderAssignmentSchema,
  sessionFolderInputSchema,
  sessionRenameSchema,
  thinkingLevels
} from "@pi-web/protocol";
import { z } from "zod";
import type { SessiondClient } from "./sessiond-client.js";

const idSchema = z.string().uuid();

export function registerSessionRoutes(
  app: FastifyInstance,
  client: SessiondClient
): void {
  app.get("/api/sessions", async () => await client.request("sessions.list"));
  app.post<{ Body: unknown }>("/api/sessions", async (request, reply) => {
    const input = createSessionSchema.parse(request.body);
    const session = await client.request<{ id: string }>(
      "sessions.create",
      input,
      120_000
    );
    return reply.code(201).send(session);
  });
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id",
    async (request) => {
      const input = sessionRenameSchema.parse(request.body);
      return await client.request("sessions.rename", {
        id: idSchema.parse(request.params.id),
        ...input
      });
    }
  );
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/pin",
    async (request) =>
      await client.request("sessions.pin", {
        id: idSchema.parse(request.params.id),
        pinned: z.object({ pinned: z.boolean() }).parse(request.body).pinned
      })
  );
  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request) =>
      await client.request("sessions.delete", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/sessions/:id",
    async (request) =>
      await client.request("sessions.snapshot", {
        id: idSchema.parse(request.params.id),
        cursor: request.query.cursor
      })
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/resume",
    async (request) => {
      const input = resumeSessionSchema.parse(request.body ?? {});
      return await client.request("sessions.resume", {
        id: idSchema.parse(request.params.id),
        ...input
      });
    }
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/messages",
    async (request, reply) => {
      const input = promptSchema.parse(request.body);
      await client.request("sessions.prompt", {
        id: idSchema.parse(request.params.id),
        ...input
      });
      return reply.code(202).send({ accepted: true });
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/abort",
    async (request) =>
      await client.request("sessions.abort", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/close",
    async (request) =>
      await client.request("sessions.close", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.put<{ Params: { id: string }; Body: { model?: string } }>(
    "/api/sessions/:id/model",
    async (request) =>
      await client.request("sessions.model", {
        id: idSchema.parse(request.params.id),
        model: z.string().min(3).max(300).parse(request.body?.model)
      })
  );
  app.put<{ Params: { id: string }; Body: { thinkingLevel?: string } }>(
    "/api/sessions/:id/thinking",
    async (request) =>
      await client.request("sessions.thinking", {
        id: idSchema.parse(request.params.id),
        thinkingLevel: z.enum(thinkingLevels).parse(request.body?.thinkingLevel)
      })
  );

  app.get("/api/session-folders", async () =>
    await client.request("session_folders.get")
  );
  app.post<{ Body: unknown }>("/api/session-folders", async (request, reply) =>
    reply.code(201).send(
      await client.request(
        "session_folders.create",
        sessionFolderInputSchema.parse(request.body)
      )
    )
  );
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/session-folders/:id",
    async (request) =>
      await client.request("session_folders.rename", {
        id: idSchema.parse(request.params.id),
        ...sessionFolderInputSchema.parse(request.body)
      })
  );
  app.delete<{ Params: { id: string } }>(
    "/api/session-folders/:id",
    async (request) =>
      await client.request("session_folders.remove", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.put<{ Params: { sessionId: string }; Body: unknown }>(
    "/api/session-folders/assign/:sessionId",
    async (request) =>
      await client.request("session_folders.assign", {
        sessionId: idSchema.parse(request.params.sessionId),
        ...sessionFolderAssignmentSchema.parse(request.body)
      })
  );
}
