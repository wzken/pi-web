import type {
  QueuedMessages,
  SessionStatus,
  ThinkingLevel
} from "@pi-web/protocol";
import { CircleStop, Send } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
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
  useAttachmentDropZone,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    images,
    setImages,
    clear: clearImages
  } = useImageAttachmentDraft(draftScope);
  const [files, setFiles] = useState<PendingFileAttachment[]>([]);
  const queueAttachments = useAttachmentSelectionQueue({
    scope: draftScope,
    images,
    files,
    onImagesChange: setImages,
    onFilesChange: setFiles,
    onError
  });
  const [mode, setMode] = useState<"steer" | "follow_up">("steer");
  const [busy, setBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
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
  const addAttachments = useCallback(async (selected: File[]) => {
    setAttachmentBusy(true);
    try {
      await queueAttachments(selected);
    } finally {
      setAttachmentBusy(false);
    }
  }, [queueAttachments]);
  const { dragActive, dropZoneProps } = useAttachmentDropZone({
    disabled: !canCompose || busy,
    onAdd: addAttachments
  });

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const contentHeight = textarea.scrollHeight;
    const height = Math.min(Math.max(contentHeight, 26), 160);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = contentHeight > 160 ? "auto" : "hidden";
  }, [files.length, images.length, message]);

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
      busy ||
      attachmentBusy
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
    <form
      className={ui(`composer${dragActive ? " attachment-drag-active" : ""}`)}
      aria-busy={busy || attachmentBusy}
      onSubmit={submit}
      {...dropZoneProps}
    >
      {(running || feedback) && (
        <div className={ui("composer-modes")}>
          {running && (
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
          )}
          {feedback && (
            <span className={ui("composer-feedback")} role="status">
              {feedback}
            </span>
          )}
        </div>
      )}
      <QueuedMessagesPanel queuedMessages={queuedMessages} />
      <div className={ui("composer-box")}>
        {dragActive && (
          <div className={ui("attachment-drop-overlay")} role="status">
            {t("拖放图片或文件到这里")}
          </div>
        )}
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
        <textarea
          ref={textareaRef}
          rows={1}
          value={message}
          disabled={!canCompose}
          aria-label={t("给 Pi 一条新指令…")}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
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
        <div className={ui("composer-toolbar")}>
          <div className={ui("composer-toolbar-start")}>
            <AttachmentPicker
              disabled={!canCompose || busy || attachmentBusy}
              onAdd={addAttachments}
            />
          </div>
          <div className={ui("composer-toolbar-end")}>
            <RuntimeSettings
              sessionId={sessionId}
              model={model}
              thinkingLevel={thinkingLevel}
              active={active && connected}
              onError={onError}
              onUpdated={onRuntimeUpdated}
            />
            {running ? (
              <Button
                type="button"
                variant="primary"
                size="icon"
                loading={stopBusy}
                loadingLabel={t("停止中…")}
                aria-label={t("停止当前任务")}
                tooltip={t("停止当前任务")}
                onClick={() => void stop()}
              >
                <CircleStop size={18} />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={
                  (!message.trim() && images.length === 0 && files.length === 0) ||
                  !canCompose ||
                  attachmentBusy
                }
                loading={busy}
                loadingLabel={t("发送中…")}
                aria-label={resumesOnSubmit ? t("发送并恢复") : t("发送")}
                tooltip={resumesOnSubmit ? t("发送新指令并恢复会话") : t("发送")}
                size="icon"
              >
                <Send size={17} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
