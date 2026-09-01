import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PiWebError } from "@pi-web/shared";

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".sh",
  ".ps1"
]);

export async function sendRawFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  forceDownload: boolean
): Promise<FastifyReply> {
  const info = await stat(path);
  if (!info.isFile()) throw new PiWebError("NOT_A_FILE", "Path is not a file", 400);
  const sniffed = await sniffFile(path);
  const filename = basename(path);
  const dangerousDocument =
    extname(filename).toLowerCase() === ".svg" ||
    extname(filename).toLowerCase() === ".html" ||
    extname(filename).toLowerCase() === ".htm";
  const disposition =
    forceDownload || dangerousDocument || sniffed.preview === "none"
      ? "attachment"
      : "inline";
  reply.header(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
  );
  reply.header("Accept-Ranges", "bytes");
  reply.type(dangerousDocument ? "text/plain; charset=utf-8" : sniffed.mime);

  const range = parseRange(request.headers.range, info.size);
  if (range) {
    reply.code(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    reply.header("Content-Length", range.end - range.start + 1);
    return reply.send(createReadStream(path, range));
  }
  reply.header("Content-Length", info.size);
  return reply.send(createReadStream(path));
}

interface SniffResult {
  mime: string;
  preview: "text" | "image" | "audio" | "video" | "pdf" | "none";
}

export async function sniffFile(path: string): Promise<SniffResult> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { mime: "image/png", preview: "image" };
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { mime: "image/jpeg", preview: "image" };
    }
    if (data.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
      return { mime: "image/gif", preview: "image" };
    }
    if (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return { mime: "image/webp", preview: "image" };
    }
    if (data.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { mime: "application/pdf", preview: "pdf" };
    }
    if (data.subarray(0, 4).toString("ascii") === "OggS") {
      return { mime: "audio/ogg", preview: "audio" };
    }
    if (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WAVE"
    ) {
      return { mime: "audio/wav", preview: "audio" };
    }
    if (data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && (data[1] ?? 0) >= 0xe0)) {
      return { mime: "audio/mpeg", preview: "audio" };
    }
    if (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp") {
      return { mime: "video/mp4", preview: "video" };
    }
    const ext = extname(path).toLowerCase();
    if (isLikelyText(data) && TEXT_EXTENSIONS.has(ext)) {
      const mime =
        ext === ".md" || ext === ".markdown"
          ? "text/markdown; charset=utf-8"
          : ext === ".json" || ext === ".jsonl"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8";
      return { mime, preview: "text" };
    }
    return { mime: "application/octet-stream", preview: "none" };
  } finally {
    await handle.close();
  }
}

function isLikelyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) throw new PiWebError("INVALID_RANGE", "Invalid Range header", 416);
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      throw new PiWebError("INVALID_RANGE", "Invalid suffix range", 416);
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new PiWebError("RANGE_NOT_SATISFIABLE", "Range not satisfiable", 416);
  }
  return { start, end: Math.min(end, size - 1) };
}
