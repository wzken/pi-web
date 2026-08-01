import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { maxPromptRequestBytes } from "@pi-web/protocol";
import { registerAuthRoutes } from "./auth-routes.js";
import type { AuthManager } from "./auth.js";
import { registerControlRoutes } from "./control-routes.js";
import { registerFileRoutes } from "./files.js";
import {
  registerGatewayErrorHandler,
  registerGatewaySecurity,
  registerWebAssets
} from "./gateway.js";
import { registerRealtimeRoute } from "./realtime.js";
import { registerSessionRoutes } from "./session-routes.js";
import type { SessiondClient } from "./sessiond-client.js";
import { registerThemeRoutes } from "./themes.js";
import { registerTerminalRoutes } from "./terminal.js";

export { syncBrowserSubscription } from "./realtime.js";

export async function createServer(options: {
  config: PiWebConfig;
  paths: PiWebPaths;
  client: SessiondClient;
  auth: AuthManager;
}): Promise<FastifyInstance> {
  let config = options.config;
  const { client, auth } = options;
  const app = Fastify({
    logger: {
      level: process.env.PI_WEB_LOG_LEVEL || "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "body.key",
        "body.token"
      ]
    },
    trustProxy: config.trustedProxy,
    bodyLimit: maxPromptRequestBytes
  });

  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
        fontSrc: ["'self'", "data:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 }
  });

  registerGatewaySecurity(app, auth);
  registerGatewayErrorHandler(app);
  registerAuthRoutes(app, auth, () => config);
  registerControlRoutes(app, client, auth, (updated) => {
    config = updated;
  });
  registerSessionRoutes(app, client);
  registerThemeRoutes(app, options.paths);
  registerFileRoutes(app, client, () => config);
  registerTerminalRoutes(app, client, () => config);
  registerRealtimeRoute(app, client);
  await registerWebAssets(app);

  return app;
}
