import { Switch } from "../../components";
import { ui } from "../../ui";
import styles from "../../pages/SettingsPage.module.css";

export function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  danger = false,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  danger?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={ui(styles.toggleRow, danger && styles.dangerToggle)}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch
        className={styles.rowSwitch}
        label={label}
        checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
