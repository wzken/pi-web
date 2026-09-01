import type {
  SessionSnapshot,
  SessionStatus
} from "@pi-web/protocol";
import { useCallback, useRef, useState, type Dispatch } from "react";
import { api, jsonBody } from "../../../api";
import { useToast } from "../../../components";
import { PendingMutationTracker } from "../../../mutation-id";
import type { RetryablePrompt } from "../../../session-messages";
import type {
  SessionControlAction,
  SessionDetailAction
} from "../types";
import { safeFileName } from "../utils/session-formatting";
import { t } from "../../../i18n";
import { useNavigate } from "../../../router";

interface UseSessionControlsOptions {
  sessionId: string;
  snapshot: SessionSnapshot | null;
  dispatch: Dispatch<SessionDetailAction>;
  refresh: () => Promise<boolean>;
}

export function useSessionControls({
  sessionId,
  snapshot,
  dispatch,
  refresh
}: UseSessionControlsOptions) {
  const toast = useToast();
  const navigate = useNavigate();
  const controlInFlight = useRef(false);
  const replayInFlight = useRef(false);
  const resumeMutation = useRef(new PendingMutationTracker());
  const replayMutation = useRef(new PendingMutationTracker());
  const [sessionMutationBusy, setSessionMutationBusy] = useState<
    "fork" | "delete" | null
  >(null);

  const control = useCallback(
    async (action: SessionControlAction): Promise<boolean> => {
      if (controlInFlight.current) return false;
      controlInFlight.current = true;
      dispatch({ type: "controlBusy.set", action });
      dispatch({ type: "error.set", error: null });
      try {
        const mutationId =
          action === "resume"
            ? resumeMutation.current.reserve({
                operation: "sessions.resume",
                sessionId,
                payload: {}
              })
            : null;
        await api(`/api/sessions/${sessionId}/${action}`, {
          method: "POST",
          ...jsonBody(mutationId ? { mutationId } : {})
        });
        if (mutationId) resumeMutation.current.confirm(mutationId);
        toast.push(
          action === "abort"
            ? t("已请求中止当前轮次")
            : action === "resume"
              ? t("正在恢复 Pi Worker")
              : t("会话 Worker 已关闭")
        );
        await refresh();
        return true;
      } catch (error) {
        dispatch({ type: "error.set", error });
        return false;
      } finally {
        controlInFlight.current = false;
        dispatch({ type: "controlBusy.set", action: null });
      }
    },
    [dispatch, refresh, sessionId, toast]
  );

  const replayLastPrompt = useCallback(
    async (prompt: RetryablePrompt, status: SessionStatus) => {
      if (replayInFlight.current) return;
      const imageNote =
        prompt.images.length > 0
          ? t("，并重新发送 {{count}} 张图片", {
              count: prompt.images.length
            })
          : "";
      if (
        !window.confirm(
          t("这会再次执行最后一条用户指令{{imageNote}}，可能重复修改文件或运行命令。继续吗？", {
            imageNote
          })
        )
      ) {
        return;
      }
      replayInFlight.current = true;
      dispatch({ type: "replayBusy.set", busy: true });
      dispatch({ type: "error.set", error: null });
      try {
        const waiting = status === "waiting";
        const path = waiting ? "messages" : "resume";
        const payload = waiting
          ? { ...prompt, behavior: "prompt" as const }
          : { prompt: prompt.message, images: prompt.images };
        const mutationId = replayMutation.current.reserve({
          operation: waiting ? "sessions.prompt" : "sessions.resume",
          sessionId,
          payload
        });
        await api(
          `/api/sessions/${sessionId}/${path}`,
          {
            method: "POST",
            ...jsonBody({ ...payload, mutationId })
          }
        );
        replayMutation.current.confirm(mutationId);
        await refresh();
        toast.push(t("最后一条指令已重新发送"));
      } catch (error) {
        dispatch({ type: "error.set", error });
      } finally {
        replayInFlight.current = false;
        dispatch({ type: "replayBusy.set", busy: false });
      }
    },
    [dispatch, refresh, sessionId, toast]
  );

  const exportSession = useCallback(() => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(snapshot.session.displayName)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.push(t("会话快照已导出"));
  }, [snapshot, toast]);

  const forkSession = useCallback(async () => {
    if (!snapshot || sessionMutationBusy) return;
    if (
      !window.confirm(
        t("将从当前进度创建一个独立分支，并关闭当前会话 Worker。继续吗？")
      )
    ) {
      return;
    }
    setSessionMutationBusy("fork");
    dispatch({ type: "error.set", error: null });
    try {
      const forked = await api<{ id: string }>(
        `/api/sessions/${sessionId}/fork`,
        { method: "POST" }
      );
      toast.push(t("会话分支已创建"));
      navigate(`/sessions/${forked.id}`);
    } catch (error) {
      dispatch({ type: "error.set", error });
    } finally {
      setSessionMutationBusy(null);
    }
  }, [dispatch, navigate, sessionId, sessionMutationBusy, snapshot, toast]);

  const deleteSession = useCallback(async () => {
    if (!snapshot || sessionMutationBusy) return;
    if (
      !window.confirm(
        t("确定永久删除会话“{{name}}”？会话记录将被删除且无法恢复。", {
          name: snapshot.session.displayName
        })
      )
    ) {
      return;
    }
    setSessionMutationBusy("delete");
    dispatch({ type: "error.set", error: null });
    try {
      if (["starting", "running", "waiting", "stopping"].includes(snapshot.session.status)) {
        await api(`/api/sessions/${sessionId}/close`, { method: "POST" });
      }
      await api(`/api/sessions/${sessionId}`, { method: "DELETE" });
      toast.push(t("会话已删除"));
      navigate("/");
    } catch (error) {
      dispatch({ type: "error.set", error });
    } finally {
      setSessionMutationBusy(null);
    }
  }, [dispatch, navigate, sessionId, sessionMutationBusy, snapshot, toast]);

  return {
    control,
    replayLastPrompt,
    exportSession,
    forkSession,
    deleteSession,
    sessionMutationBusy
  };
}
