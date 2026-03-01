// TasksPage — task management with quick-add and status tabs.
//
// Views: Active (todo + in_progress) | Today | Done
// Quick-add: type a task title and press Enter to create it instantly.
// Each task: checkbox to mark done, priority badge, due date, edit slide-over.

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type TaskStatus = "todo" | "in_progress" | "done" | "skipped";
type TaskPriority = "low" | "medium" | "high" | "urgent";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  scheduledDate?: string | null;
  completedAt?: string | null;
  tags: string[];
  createdAt: string;
}

interface TaskFormData {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  scheduledDate: string;
  status: TaskStatus;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-gray-100 text-gray-500",
  medium: "bg-blue-100 text-blue-600",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-gray-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

const EMPTY_FORM: TaskFormData = {
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  scheduledDate: TODAY,
  status: "todo",
};

// ── API calls ──────────────────────────────────────────────────────────────────

interface TaskPayload {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  scheduledDate?: string;
  status?: TaskStatus;
}

const tasksApi = {
  list: (status: string, date?: string) => {
    const params = new URLSearchParams({ status });
    if (date) params.set("date", date);
    return apiFetch<Task[]>(`/api/tasks?${params}`);
  },
  create: (data: TaskPayload) =>
    apiFetch<Task>("/api/tasks", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<TaskPayload> & { status?: TaskStatus }) =>
    apiFetch<Task>(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" }),
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function SlideOver({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full z-50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>
    </div>
  );
}

function TaskForm({
  initial,
  onSave,
  onCancel,
  onDelete,
  isPending,
  error,
  isEditing,
}: {
  initial: TaskFormData;
  onSave: (data: TaskFormData) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isPending: boolean;
  error?: string;
  isEditing: boolean;
}) {
  const [form, setForm] = useState<TaskFormData>(initial);

  function set<K extends keyof TaskFormData>(field: K, value: TaskFormData[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const inputClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400";
  const selectClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      className="flex flex-col h-full"
    >
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Task <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What needs to be done?"
            required
            autoFocus
            className={inputClass}
          />
        </div>

        {/* Priority + Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)} className={selectClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)} className={selectClass}>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
        </div>

        {/* Scheduled date + Due date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Scheduled</label>
            <input
              type="date"
              value={form.scheduledDate}
              onChange={(e) => set("scheduledDate", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Due date</label>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Optional details or context"
            className={`${inputClass} resize-none`}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-4 space-y-2">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !form.title}
            className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? "Saving…" : "Save task"}
          </button>
        </div>
        {isEditing && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="w-full py-2 px-4 text-red-600 hover:text-red-800 text-xs font-medium"
          >
            Delete this task
          </button>
        )}
      </div>
    </form>
  );
}

// ── Task row ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onToggle,
  onEdit,
}: {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const isDone = task.status === "done" || task.status === "skipped";
  const isOverdue =
    task.dueDate &&
    task.dueDate < TODAY &&
    !isDone;

  return (
    <div
      className="flex items-start gap-3 py-3 px-4 hover:bg-gray-50 rounded-lg group transition-colors cursor-pointer"
      onClick={onEdit}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          isDone
            ? "bg-green-500 border-green-500"
            : "border-gray-300 hover:border-indigo-500"
        }`}
      >
        {isDone && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-sm font-medium ${
              isDone ? "line-through text-gray-400" : "text-gray-900"
            }`}
          >
            {task.title}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[task.priority]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} />
            {task.priority}
          </span>
        </div>
        {task.description && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
        )}
      </div>

      {/* Due date */}
      {task.dueDate && (
        <span
          className={`text-xs flex-shrink-0 ${
            isOverdue ? "text-red-600 font-medium" : "text-gray-400"
          }`}
        >
          {isOverdue ? "Overdue · " : "Due "}
          {new Date(task.dueDate + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type TabKey = "active" | "today" | "done";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "today", label: "Today" },
  { key: "done", label: "Done" },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("today");
  const [editing, setEditing] = useState<Task | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [quickAdd, setQuickAdd] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  // Query key + params depend on the current tab
  const queryDate = tab === "today" ? TODAY : undefined;
  const queryStatus = tab === "done" ? "done" : "active";

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", tab],
    queryFn: () => tasksApi.list(queryStatus, queryDate),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  // Quick-add mutation (Enter key creates instantly)
  const quickCreateMutation = useMutation({
    mutationFn: (title: string) =>
      tasksApi.create({ title, scheduledDate: TODAY, priority: "medium" }),
    onSuccess: () => {
      invalidate();
      setQuickAdd("");
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: TaskPayload) => tasksApi.create(data),
    onSuccess: () => { invalidate(); setAddingNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof tasksApi.update>[1] }) =>
      tasksApi.update(id, data),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: tasksApi.delete,
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  function handleToggle(task: Task) {
    const newStatus: TaskStatus = task.status === "done" ? "todo" : "done";
    updateMutation.mutate({ id: task.id, data: { status: newStatus } });
  }

  function handleQuickAdd(e: React.KeyboardEvent) {
    if (e.key === "Enter" && quickAdd.trim()) {
      quickCreateMutation.mutate(quickAdd.trim());
    }
  }

  function handleSave(formData: TaskFormData) {
    const clean = {
      title: formData.title,
      description: formData.description || undefined,
      priority: formData.priority,
      dueDate: formData.dueDate || undefined,
      scheduledDate: formData.scheduledDate || undefined,
      status: formData.status,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data: clean });
    } else {
      createMutation.mutate(clean);
    }
  }

  const panelOpen = addingNew || editing !== null;

  const formInitial: TaskFormData = editing
    ? {
        title: editing.title,
        description: editing.description ?? "",
        priority: editing.priority,
        dueDate: editing.dueDate ?? "",
        scheduledDate: editing.scheduledDate ?? "",
        status: editing.status,
      }
    : EMPTY_FORM;

  const mutationError =
    (createMutation.error as Error)?.message ??
    (updateMutation.error as Error)?.message;
  const mutationPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setAddingNew(true); }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New task
        </button>
      </div>

      {/* Quick-add field */}
      <div className="relative mb-5">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-lg leading-none select-none">
          +
        </span>
        <input
          ref={quickRef}
          type="text"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          onKeyDown={handleQuickAdd}
          placeholder="Quick add — type a task and press Enter"
          className="w-full pl-9 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                     placeholder:text-gray-400 shadow-sm"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-14 text-center">
          <p className="text-gray-400 text-sm">
            {tab === "today"
              ? "Nothing scheduled for today."
              : tab === "done"
              ? "No completed tasks yet."
              : "No active tasks."}
          </p>
          {tab !== "done" && (
            <button
              onClick={() => quickRef.current?.focus()}
              className="mt-2 text-indigo-600 text-sm font-medium hover:underline"
            >
              Add one above →
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => handleToggle(task)}
              onEdit={() => { setEditing(task); setAddingNew(false); }}
            />
          ))}
        </div>
      )}

      {/* Slide-over */}
      <SlideOver
        open={panelOpen}
        title={editing ? "Edit task" : "New task"}
        onClose={() => { setEditing(null); setAddingNew(false); }}
      >
        <TaskForm
          key={editing?.id ?? "new"}
          initial={formInitial}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setAddingNew(false); }}
          onDelete={editing ? () => {
            if (confirm(`Delete "${editing.title}"?`)) deleteMutation.mutate(editing.id);
          } : undefined}
          isPending={mutationPending}
          error={mutationError}
          isEditing={!!editing}
        />
      </SlideOver>
    </div>
  );
}
