import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import {
  remoteAccessInfo,
  type RemoteAccessDependencies
} from "./remote-access.js";

function request(protocol: "http" | "https", host: string): FastifyRequest {
  return {
    protocol,
    headers: { host }
  } as unknown as FastifyRequest;
}

function config(patch: Partial<PiWebConfig> = {}): PiWebConfig {
  return {
    port: 8787,
    cookieSecure: "auto",
    trustedProxy: false,
    ...patch
  } as PiWebConfig;
}

function dependencies(
  patch: Partial<RemoteAccessDependencies> = {}
): RemoteAccessDependencies {
  return {
    inspectTailscale: vi.fn(async () => ({
      installed: true,
      running: true,
      dnsName: "pi-web.tailnet.ts.net",
      serveUrl: "https://pi-web.tailnet.ts.net",
      addresses: [
        {
          kind: "tailscale-https" as const,
          label: "Tailscale HTTPS",
          url: "https://pi-web.tailnet.ts.net",
          secure: true
        }
      ]
    })),
    lanAddresses: vi.fn(() => [
      {
        kind: "lan" as const,
        label: "LAN · eth0",
        url: "http://192.168.50.119:8787",
        secure: false
      }
    ]),
    qrDataUrl: vi.fn(async (value: string) => `data:image/png;base64,${value}`),
    ...patch
  };
}

describe("remote access projection", () => {
  it("prefers an existing Tailscale HTTPS address and generates its QR code", async () => {
    const deps = dependencies();
    const result = await remoteAccessInfo(
      request("http", "127.0.0.1:8787"),
      config(),
      deps
    );

    expect(result.preferredUrl).toBe("https://pi-web.tailnet.ts.net");
    expect(result.qrDataUrl).toContain("https://pi-web.tailnet.ts.net");
    expect(result.addresses.map((address) => address.kind)).toEqual([
      "current",
      "lan",
      "tailscale-https"
    ]);
    expect(result.security.warnings).toEqual([]);
    expect(deps.qrDataUrl).toHaveBeenCalledWith(
      "https://pi-web.tailnet.ts.net",
      expect.objectContaining({ width: 320 })
    );
  });

  it("warns when only plain HTTP is available and reports proxy/cookie risks", async () => {
    const deps = dependencies({
      inspectTailscale: vi.fn(async () => ({
        installed: false,
        running: false,
        dnsName: null,
        serveUrl: null,
        addresses: []
      }))
    });
    const result = await remoteAccessInfo(
      request("http", "192.168.50.119:8787"),
      config({ cookieSecure: "never", trustedProxy: true }),
      deps
    );

    expect(result.preferredUrl).toBe("http://192.168.50.119:8787");
    expect(result.security.warnings).toHaveLength(3);
    expect(result.security.warnings.join("\n")).toContain("plain HTTP");
    expect(result.security.warnings.join("\n")).toContain("Secure cookies");
    expect(result.security.warnings.join("\n")).toContain("Trusted proxy");
  });
});
