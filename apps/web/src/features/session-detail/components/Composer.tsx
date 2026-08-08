import type {
  QueuedMessages,
  SessionStatus,
  ThinkingLevel
} from "@pi-web/protocol";
import { CircleStop, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, jsonBody } from "../../../api";
import {
  draftAfterSuccessfulSubmit,
  resolveComposerSubmissionRoute,
  shouldSubmitComposerInput
} from "../../../composer-input";
import { Button } from "../../../components";
import { clearDraft, readDraft, writeDraft } from "../../../draft-store";
import {
  appendAttachmentReferences,
  AttachmentPicker,
  FileAttachmentTray,
  useAttachmentSelectionQueue,
  uploadAttachments,
  type PendingFileAttachment
} from "../../../FileAttachments";
import {
  ImageAttachmentTray,
  useImageAttachmentDraft
} from "../../../ImageAttachments";
import { PendingMutationTracker } from "../../../mutation-id";
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
  onError,
  onRuntimeUpdated
}: ComposerProps) {
  const draftScope = `session:${sessionId}`;
  const [message, setMessage] = useState(() => readDraft(draftScope));
  const messageRef = useRef(message);
  const {
    images,
    setImages,
    clear: clearImages
  } = useImageAttachmentDraft(draftScope);
  const [files, setFiles] = useState<PendingFileAttachment[]>([]);
  const addAttachments = useAttachmentSelectionQueue({
    scope: draftScope,
    images,
    files,
    onImagesChange: setImages,
    onFilesChange: setFiles,
    onError
  });
  const [mode, setMode] = useState<"steer" | "follow_up">("steer");
  const [busy, setBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const promptMutation = useRef(new PendingMutationTracker());
  const oneTimeFollowUp = useRef(false);
  const active = ["starting", "running", "waiting", "stopping"].includes(
    status
  );
  const running = status === "running";
  const submissionRoute = resolveComposerSubmissionRoute(status, mode);
  const canCompose = connected && submissionRoute !== null;
  const resumesOnSubmit =
    connected && submissionRoute?.path === "resume";
  const effectiveMode = running ? mode : "prompt";

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const followUpOverride = oneTimeFollowUp.current;
    oneTimeFollowUp.current = false;
    const route = resolveComposerSubmissionRoute(
      status,
      mode,
      followUpOverride
    );
    const value = message.trim();
    if (
      (!value && images.length === 0 && files.length === 0) ||
      !canCompose ||
      route === null ||
      busy
    ) {
      return;
    }
    setBusy(true);
    const submittedDraft = message;
    try {
      const uploaded = await uploadAttachments(cwd, files);
      const submittedMessage = appendAttachmentReferences(value, uploaded);
      const submittedImages = images.map(({ type, mimeType, data }) => ({
        type,
        mimeType,
        data
      }));
      const payload =
        route.path === "resume"
          ? {
              prompt: submittedMessage,
              images: submittedImages
            }
          : {
              message: submittedMessage,
              images: submittedImages,
              behavior: route.behavior
            };
      const mutationId = promptMutation.current.reserve({
        operation: route.operation,
        sessionId,
        payload
      });
      await api(`/api/sessions/${sessionId}/${route.path}`, {
        method: "POST",
        ...jsonBody({
          ...payload,
          mutationId
        })
      });
      promptMutation.current.confirm(mutationId);
      const nextDraft = draftAfterSuccessfulSubmit(
        messageRef.current,
        submittedDraft
      );
      messageRef.current = nextDraft;
      setMessage(nextDraft);
      await clearImages();
      setFiles([]);
      if (nextDraft) writeDraft(draftScope, nextDraft);
      else clearDraft(draftScope);
      if (running) {
        setFeedback(
          route.path === "messages" && route.behavior === "steer"
            ? t("已发送为立即引导，Pi 会在下一个可中断点调整方向。")
            : t("消息已排队，将在当前任务完成后发送。")
        );
      }
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
              disabled={busy}
              onClick={() => setMode("follow_up")}
            >
              {t("完成后排队")}
            </Button>
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              active={effectiveMode === "steer"}
              disabled={busy}
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
                  : resumesOnSubmit
                    ? t("发送指令并恢复会话")
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
        <RuntimeSettings
          sessionId={sessionId}
          model={model}
          thinkingLevel={thinkingLevel}
          active={active && connected}
          onError={onError}
          onUpdated={onRuntimeUpdated}
        />
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
          disabled={!canCompose || busy}
          onAdd={addAttachments}
        />
        <textarea
          rows={2}
          value={message}
          disabled={!canCompose}
          aria-label={t("给 Pi 一条新指令…")}
          onChange={(event) => {
            const value = event.target.value;
            messageRef.current = value;
            setMessage(value);
            writeDraft(draftScope, value);
          }}
          onPaste={(event) => {
            if (busy) return;
            const files = Array.from(event.clipboardData.items)
              .filter((item) => item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (files.length === 0) return;
            event.preventDefault();
            void addAttachments(files);
          }}
          onKeyDown={(event) => {
            if (
              shouldSubmitComposerInput({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode
              })
            ) {
              event.preventDefault();
              oneTimeFollowUp.current = running && event.altKey;
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            running
              ? effectiveMode === "steer"
                ? t("调整 Pi 当前方向…")
                : t("安排当前任务完成后的下一步…")
              : resumesOnSubmit
                ? t("输入新指令，发送后恢复会话…")
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
              : resumesOnSubmit
                ? t("发送并恢复")
              : t("发送")
          }
          tooltip={
            running
              ? effectiveMode === "steer"
                ? t("立即引导当前任务")
                : t("当前任务完成后发送")
              : resumesOnSubmit
                ? t("发送新指令并恢复会话")
              : t("发送")
          }
          size="icon"
        >
          <Send size={17} />
        </Button>
      </div>
      <div className={ui("composer-meta")}>
        <span className={ui("composer-thinking-status")}>
          {thinkingLevel ?? t("默认思考")}
        </span>
        <span className={ui("composer-shortcut-hint")}>
          {running
            ? t("Enter 按当前模式发送 · Alt+Enter 完成后排队 · Shift+Enter 换行")
            : t("Enter 发送 · Shift+Enter 换行")}
        </span>
      </div>
    </form>
  );
}
