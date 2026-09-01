import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import type { FastifyRequest } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import type {
  RemoteAccessAddress,
  RemoteAccessInfo
} from "@pi-web/protocol";
import QRCode from "qrcode";

const execFileAsync = promisify(execFile);

export interface RemoteAccessDependencies {
  inspectTailscale: (port: number) => Promise<TailscaleInspection>;
  lanAddresses: (port: number) => RemoteAccessAddress[];
  qrDataUrl: (
    text: string,
    options: {
      type: "image/png";
      width: number;
      margin: number;
      errorCorrectionLevel: "M";
      color: { dark: string; light: string };
    }
  ) => Promise<string>;
}

const defaultDependencies: RemoteAccessDependencies = {
  inspectTailscale,
  lanAddresses,
  qrDataUrl: async (text, options) => await QRCode.toDataURL(text, options)
};

export async function remoteAccessInfo(
  request: FastifyRequest,
  config: PiWebConfig,
  dependencies: RemoteAccessDependencies = defaultDependencies
): Promise<RemoteAccessInfo> {
  const currentUrl = `${request.protocol}://${request.headers.host}`;
  const tailscale = await dependencies.inspectTailscale(config.port);
  const addresses = dedupeAddresses([
    {
      kind: "current",
      label: "Current connection",
      url: currentUrl,
      secure: request.protocol === "https"
    },
    ...dependencies.lanAddresses(config.port),
    ...tailscale.addresses
  ]);
  const preferred =
    addresses.find((address) => address.kind === "tailscale-https") ??
    addresses.find((address) => address.secure) ??
    addresses.find((address) => address.kind === "lan") ??
    addresses[0]!;
  const warnings: string[] = [];
  if (!preferred.secure) {
    warnings.push(
      "The preferred remote address uses plain HTTP. Use a trusted private network or an HTTPS reverse proxy."
    );
  }
  if (config.cookieSecure === "never") {
    warnings.push("Secure cookies are explicitly disabled.");
  }
  if (config.trustedProxy && request.protocol !== "https") {
    warnings.push(
      "Trusted proxy mode is enabled, but this request was not reported as HTTPS. Verify forwarded headers."
    );
  }
  return {
    addresses,
    preferredUrl: preferred.url,
    qrDataUrl: await dependencies.qrDataUrl(preferred.url, {
      type: "image/png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#10200b", light: "#ffffff" }
    }),
    tailscale: {
      installed: tailscale.installed,
      running: tailscale.running,
      dnsName: tailscale.dnsName,
      serveUrl: tailscale.serveUrl
    },
    security: {
      authenticated: true,
      currentConnectionSecure: request.protocol === "https",
      cookieSecure: config.cookieSecure,
      trustedProxy: config.trustedProxy,
      warnings
    }
  };
}

export interface TailscaleInspection {
  installed: boolean;
  running: boolean;
  dnsName: string | null;
  serveUrl: string | null;
  addresses: RemoteAccessAddress[];
}

async function inspectTailscale(port: number): Promise<TailscaleInspection> {
  let status: Record<string, unknown>;
  try {
    const result = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 3_000,
      maxBuffer: 2 * 1024 * 1024
    });
    status = parseRecord(result.stdout);
  } catch (error) {
    return {
      installed: !isCommandMissing(error),
      running: false,
      dnsName: null,
      serveUrl: null,
      addresses: []
    };
  }
  const self = asRecord(status.Self);
  const dnsName = trimTrailingDot(stringValue(self.DNSName));
  const ips = Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs.filter((value): value is string => typeof value === "string")
    : [];
  let serveUrl: string | null = null;
  try {
    const serve = await execFileAsync(
      "tailscale",
      ["serve", "status", "--json"],
      { timeout: 3_000, maxBuffer: 2 * 1024 * 1024 }
    );
    serveUrl = findHttpsUrl(JSON.parse(serve.stdout));
  } catch {
    // Tailscale can be connected without an active Serve configuration.
  }
  if (!serveUrl && dnsName) {
    const textStatus = await execFileAsync(
      "tailscale",
      ["serve", "status"],
      { timeout: 3_000, maxBuffer: 512 * 1024 }
    ).catch(() => null);
    serveUrl = textStatus
      ? textStatus.stdout.match(/https:\/\/[^\s/]+(?:\/[^\s]*)?/i)?.[0] ?? null
      : null;
  }
  const addresses: RemoteAccessAddress[] = [];
  if (serveUrl) {
    addresses.push({
      kind: "tailscale-https",
      label: "Tailscale HTTPS",
      url: normalizeOrigin(serveUrl),
      secure: true
    });
  }
  for (const ip of ips) {
    const host = ip.includes(":") ? `[${ip}]` : ip;
    addresses.push({
      kind: "tailscale-ip",
      label: "Tailscale IP",
      url: `http://${host}:${port}`,
      secure: false
    });
  }
  return {
    installed: true,
    running: true,
    dnsName,
    serveUrl: serveUrl ? normalizeOrigin(serveUrl) : null,
    addresses
  };
}

function lanAddresses(port: number): RemoteAccessAddress[] {
  const result: RemoteAccessAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (isVirtualInterface(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (!isPrivateIpv4(entry.address)) continue;
      result.push({
        kind: "lan",
        label: `LAN · ${name}`,
        url: `http://${entry.address}:${port}`,
        secure: false
      });
    }
  }
  return result;
}

function isPrivateIpv4(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isVirtualInterface(name: string): boolean {
  return /^(docker|br-|veth|virbr|podman|cni|lo)/i.test(name);
}

function dedupeAddresses(addresses: RemoteAccessAddress[]): RemoteAccessAddress[] {
  const result = new Map<string, RemoteAccessAddress>();
  for (const address of addresses) {
    if (!result.has(address.url)) result.set(address.url, address);
  }
  return [...result.values()];
}

function findHttpsUrl(value: unknown): string | null {
  if (typeof value === "string") {
    return value.startsWith("https://") ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHttpsUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (/https/i.test(key) && typeof item === "string") {
      if (item.startsWith("https://")) return item;
    }
    const found = findHttpsUrl(item);
    if (found) return found;
  }
  return null;
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.replace(/\/$/, "");
  }
}

function parseRecord(value: string): Record<string, unknown> {
  return asRecord(JSON.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function trimTrailingDot(value: string | null): string | null {
  return value?.replace(/\.$/, "") ?? null;
}

function isCommandMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
