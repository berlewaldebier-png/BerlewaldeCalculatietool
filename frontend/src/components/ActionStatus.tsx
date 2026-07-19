import { AlertCircle, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

export type ActionStatusKind = "pending" | "success" | "warning" | "error";

export type ActionStatusState = {
  kind: ActionStatusKind;
  message: string;
  guidance?: string;
};

type ActionStatusProps = ActionStatusState & {
  id?: string;
  className?: string;
};

const STATUS_ICON = {
  pending: LoaderCircle,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
} as const;

export function ActionStatus({ id, kind, message, guidance, className = "" }: ActionStatusProps) {
  const Icon = STATUS_ICON[kind];
  const classes = ["action-status", kind, className].filter(Boolean).join(" ");

  return (
    <div
      id={id}
      className={classes}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon
        className={`action-status-icon${kind === "pending" ? " action-status-spinner" : ""}`}
        aria-hidden="true"
      />
      <span className="action-status-content">
        <span className="action-status-message">{message}</span>
        {guidance ? <span className="action-status-guidance">{guidance}</span> : null}
      </span>
    </div>
  );
}
