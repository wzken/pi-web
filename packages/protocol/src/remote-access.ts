export interface RemoteAccessAddress {
  kind: "current" | "lan" | "tailscale-ip" | "tailscale-https";
  label: string;
  url: string;
  secure: boolean;
}

export interface RemoteAccessInfo {
  addresses: RemoteAccessAddress[];
  preferredUrl: string;
  qrDataUrl: string;
  tailscale: {
    installed: boolean;
    running: boolean;
    dnsName: string | null;
    serveUrl: string | null;
  };
  security: {
    authenticated: true;
    currentConnectionSecure: boolean;
    cookieSecure: "auto" | "always" | "never";
    trustedProxy: boolean;
    warnings: string[];
  };
}
