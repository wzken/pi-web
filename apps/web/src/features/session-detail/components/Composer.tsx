import type {
  QueuedMessages,
  SessionStatus,
  ThinkingLevel
} from "@pi-web/protocol";
import { CircleStop, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "../../../api";
import { Button } from "../../../components";
import { clearDraft, readDraft, writeDraft } from "../../../draft-store";
import {
  appendAttachmentReferences,
  AttachmentPicker,
  FileAttachmentTray,
  uploadAttachments,
  type PendingFileAttachment
} from "../../../FileAttachments";
import {
  appendImageFiles,
  ImageAttachmentTray,
  useImageAttachmentDraft
} from "../../../ImageAttachments";
import { RuntimeSettings } from "./RuntimeSettings";
import { QueuedMessagesPanel } from "./QueuedMessagesPanel";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface ComposerProps {
  sessionId: string;
  cwd: string;
  status: SessionStatus;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  connected: boolean;
  queuedMessages: QueuedMessages;
  onAbort: () => Promise<boolean>;
  onSent: () => void;
  onError: (error: unknown) => void;
  onRuntimeUpdated: () => Promise<void>;
}

export function Composer({
  sessionId,
  cwd,
  status,
  model,
  thinkingLevel,
  connected,
  queuedMessages,
  onAbort,
  onSent,
  onError,
  onRuntimeUpdated
}: ComposerProps) {
  const draftScope = `session:${sessionId}`;
  const [message, setMessage] = useState(() => readDraft(draftScope));
  const {
    images,
    setImages,
    clear: clearImages
  } = useImageAttachmentDraft(draftScope);
  const [files, setFiles] = useState<PendingFileAttachment[]>([]);
  const [mode, setMode] = useState<"steer" | "follow_up">("follow_up");
  const [busy, setBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const active = ["starting", "running", "waiting", "stopping"].includes(
    status
  );
  const running = status === "running";
  const canCompose = connected && (status === "waiting" || running);
  const effectiveMode = running ? mode : "prompt";

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = message.trim();
    if (
      (!value && images.length === 0 && files.length === 0) ||
      !canCompose ||
      busy
    ) {
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadAttachments(cwd, files);
      await api(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        ...jsonBody({
          message: appendAttachmentReferences(value, uploaded),
          images: images.map(({ type, mimeType, data }) => ({
            type,
            mimeType,
            data
          })),
          behavior: effectiveMode
        })
      });
      setMessage("");
      await clearImages();
      setFiles([]);
      clearDraft(draftScope);
      if (running) {
        setFeedback(
          effectiveMode === "steer"
            ? t("已发送为立即引导，Pi 会在下一个可中断点调整方向。")
            : t("消息已排队，将在当前任务完成后发送。")
        );
      }
      onSent();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!running || stopBusy) return;
    setStopBusy(true);
    try {
      const accepted = await onAbort();
      if (accepted) {
        setFeedback(t("已请求停止当前任务；会话历史和草稿仍会保留。"));
      }
    } finally {
      setStopBusy(false);
    }
  }

  return (
    <form className={ui("composer")} onSubmit={submit}>
      <div className={ui("composer-modes")}>
        {running ? (
          <>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              active={effectiveMode === "follow_up"}
              onClick={() => setMode("follow_up")}
            >
              {t("完成后排队")}
            </Button>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              active={effectiveMode === "steer"}
              onClick={() => setMode("steer")}
            >
              {t("立即引导")}
            </Button>
          </>
        ) : (
          <span>
            {status === "waiting"
              ? t("发送下一条指令")
              : status === "starting"
                ? t("Pi 正在启动")
                : status === "stopping"
                  ? t("正在停止当前任务")
                  : connected
                    ? t("恢复会话后才能发送")
                    : t("等待实时连接")}
          </span>
        )}
        {feedback && (
          <span className={ui("composer-feedback")} role="status">
            {feedback}
          </span>
        )}
      </div>
      <QueuedMessagesPanel queuedMessages={queuedMessages} />
      <ImageAttachmentTray
        images={images}
        disabled={busy}
        onChange={setImages}
      />
      <FileAttachmentTray
        files={files}
        disabled={busy}
        onChange={setFiles}
      />
      <div className={ui("composer-box")}>
        <AttachmentPicker
          images={images}
          files={files}
          disabled={!canCompose || busy}
          onImagesChange={setImages}
          onFilesChange={setFiles}
          onError={onError}
        />
        <textarea
          rows={2}
          value={message}
          disabled={!canCompose}
          onChange={(event) => {
            const value = event.target.value;
            setMessage(value);
            writeDraft(draftScope, value);
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.items)
              .filter((item) => item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (files.length === 0) return;
            event.preventDefault();
            void appendImageFiles(images, files)
              .then(setImages)
              .catch(onError);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            running
              ? effectiveMode === "steer"
                ? t("调整 Pi 当前方向…")
                : t("安排当前任务完成后的下一步…")
              : connected
                ? t("给 Pi 一条新指令…")
                : t("实时连接恢复后可发送，草稿会保留…")
          }
        />
        {running && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            loading={stopBusy}
            loadingLabel={t("停止中…")}
            aria-label={t("停止当前任务")}
            tooltip={t("停止当前任务")}
            onClick={() => void stop()}
          >
            <CircleStop size={17} />
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            (!message.trim() && images.length === 0 && files.length === 0) ||
            !canCompose
          }
          loading={busy}
          loadingLabel={t("发送中…")}
          aria-label={
            running
              ? effectiveMode === "steer"
                ? t("立即引导")
                : t("排队发送")
              : t("发送")
          }
          tooltip={
            running
              ? effectiveMode === "steer"
                ? t("立即引导当前任务")
                : t("当前任务完成后发送")
              : t("发送")
          }
          size="icon"
        >
          <Send size={17} />
        </Button>
      </div>
      <div className={ui("composer-meta")}>
        <RuntimeSettings
          sessionId={sessionId}
          model={model}
          thinkingLevel={thinkingLevel}
          active={active && connected}
          onError={onError}
          onUpdated={onRuntimeUpdated}
        />
        <span>{thinkingLevel ?? t("默认思考")}</span>
        <span>{t("Enter 发送 · Shift+Enter 换行")}</span>
      </div>
    </form>
  );
}
