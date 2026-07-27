import { FilePlus2, FolderPlus, Pencil, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "../../../api";
import { Button, Dialog, IconButton } from "../../../components";
import type { FileEntry } from "../types";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

export type FileMutation =
  | { type: "create-file"; directoryPath: string }
  | { type: "create-directory"; directoryPath: string }
  | { type: "rename"; entry: FileEntry };

export interface FileMutationResult {
  path: string;
  name: string;
  directory: boolean;
}

interface FileMutationDialogProps {
  sessionId: string;
  mutation: FileMutation | null;
  onClose: () => void;
  onCompleted: (
    result: FileMutationResult,
    mutation: FileMutation
  ) => Promise<void>;
  onError: (error: unknown) => void;
}

export function FileMutationDialog({
  sessionId,
  mutation,
  onClose,
  onCompleted,
  onError
}: FileMutationDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(mutation?.type === "rename" ? mutation.entry.name : "");
  }, [mutation]);

  if (!mutation) return null;
  const rename = mutation.type === "rename";
  const directory =
    mutation.type === "create-directory" ||
    (rename && mutation.entry.directory);
  const itemType = directory ? t("文件夹") : t("文件");
  const title = rename
    ? t("重命名{{type}}", { type: itemType })
    : t("新建{{type}}", { type: itemType });
  const Icon = rename ? Pencil : directory ? FolderPlus : FilePlus2;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const activeMutation = mutation;
    if (!nextName || busy || !activeMutation) return;
    setBusy(true);
    try {
      const result = await api<FileMutationResult>(
        `/api/sessions/${sessionId}/file-entry`,
        {
          method: activeMutation.type === "rename" ? "PUT" : "POST",
          ...jsonBody(
            activeMutation.type === "rename"
              ? { path: activeMutation.entry.path, name: nextName }
              : {
                  path: activeMutation.directoryPath,
                  name: nextName,
                  directory: activeMutation.type === "create-directory"
                }
          )
        }
      );
      await onCompleted(result, activeMutation);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      labelledBy="file-mutation-title"
      onClose={onClose}
      className={ui("file-mutation-dialog")}
    >
      <form onSubmit={submit}>
        <header className={ui("dialog-heading")}>
          <div>
            <Icon size={17} />
            <h2 id="file-mutation-title">{title}</h2>
          </div>
          <IconButton
            type="button"
            label={t("关闭")}
            onClick={onClose}
            disabled={busy}
          >
            <X size={17} />
          </IconButton>
        </header>
        <label className={ui("field")}>
          <span>{rename ? t("新名称") : t("{{type}}名称", { type: itemType })}</span>
          <input
            autoFocus
            value={name}
            maxLength={240}
            onChange={(event) => setName(event.target.value)}
            placeholder={directory ? t("例如 docs") : t("例如 notes.md")}
          />
        </label>
        <small className={ui("file-mutation-note")}>
          {t("操作范围仅限当前会话的工作目录，且不会覆盖同名项目。")}
        </small>
        <footer className={ui("dialog-actions")}>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            {t("取消")}
          </Button>
          <Button
            type="submit"
            loading={busy}
            loadingLabel={t("处理中…")}
            disabled={!name.trim()}
          >
            {rename ? t("确认重命名") : t("创建")}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
