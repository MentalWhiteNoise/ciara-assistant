// ChecklistsPage — active checklists + checklist templates.
//
// Tab 1 — Active:
//   Left panel: list of checklists with X/Y progress.
//   Right panel: checklist detail — task list with checkboxes, add-task input.
//   Checking a task calls PUT /api/tasks/:id and persists to the DB.
//
// Tab 2 — Templates:
//   Left panel: list of templates.
//   Right panel: template detail — item list with offsets, "Start New Checklist" button.
//   "Start New Checklist" calls POST /api/checklists/from-template → generates tasks.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChecklistTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  checklistId?: string | null;
}

interface Checklist {
  id: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  status: string;
  taskCount: number;
  doneCount: number;
}

interface ChecklistDetail extends Checklist {
  tasks: ChecklistTask[];
}

interface TemplateItem {
  title: string;
  description?: string;
  offsetDays: number;
  priority: string;
}

interface Template {
  id: string;
  name: string;
  description?: string | null;
  items: TemplateItem[];
  createdAt: string;
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const inputClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-500",
  medium: "bg-blue-100 text-blue-600",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function offsetLabel(days: number) {
  if (days === 0) return "Today";
  if (days > 0) return `+${days} day${days !== 1 ? "s" : ""}`;
  return `${days} day${days !== -1 ? "s" : ""}`;
}

// ── Shared slide-over shell ────────────────────────────────────────────────────

function SlideOver({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-lg bg-white shadow-xl flex flex-col h-full">
        {children}
      </div>
    </div>
  );
}

// ── Checklist form (create / edit header) ──────────────────────────────────────

function ChecklistForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Checklist;
  onSave: (data: { name: string; description: string; dueDate: string; status: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [status, setStatus] = useState(initial?.status ?? "active");

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ name, description, dueDate, status }); }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">
          {initial ? "Edit Checklist" : "New Checklist"}
        </h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Name *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Convention Prep" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="What is this checklist for?" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </div>
        {initial && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}
      </div>
      <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          {initial ? "Save changes" : "Create checklist"}
        </button>
      </div>
    </form>
  );
}

// ── Template form (create / edit) ──────────────────────────────────────────────

function TemplateForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Template;
  onSave: (data: { name: string; description: string; items: TemplateItem[] }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<TemplateItem[]>(
    initial?.items ?? []
  );

  const addItem = () =>
    setItems((prev) => [...prev, { title: "", offsetDays: 0, priority: "medium" }]);

  const updateItem = (idx: number, field: keyof TemplateItem, value: string | number) =>
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const moveItem = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setItems(next);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ name, description, items: items.filter((i) => i.title.trim()) }); }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">
          {initial ? "Edit Template" : "New Template"}
        </h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Name *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Convention Prep Template" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} resize-none`} />
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tasks</p>
            <button type="button" onClick={addItem} className="text-xs text-indigo-600 hover:underline">+ Add task</button>
          </div>
          {items.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg">
              <p className="text-sm text-gray-400">No tasks yet.</p>
              <button type="button" onClick={addItem} className="mt-2 text-xs text-indigo-600 hover:underline">Add the first task</button>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5">
                      <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">▲</button>
                      <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">▼</button>
                    </div>
                    <input
                      value={item.title}
                      onChange={(e) => updateItem(idx, "title", e.target.value)}
                      placeholder="Task title *"
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button type="button" onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 ml-7">
                    <div>
                      <label className="text-xs text-gray-400">Offset (days from today)</label>
                      <input
                        type="number"
                        value={item.offsetDays}
                        onChange={(e) => updateItem(idx, "offsetDays", parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="0"
                      />
                      <p className="text-xs text-gray-400 mt-0.5">
                        {item.offsetDays === 0 ? "Due today" : item.offsetDays > 0 ? `${item.offsetDays}d after today` : `${Math.abs(item.offsetDays)}d before today`}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Priority</label>
                      <select
                        value={item.priority}
                        onChange={(e) => updateItem(idx, "priority", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <input
                    value={item.description ?? ""}
                    onChange={(e) => updateItem(idx, "description", e.target.value)}
                    placeholder="Notes (optional)"
                    className="ml-7 w-[calc(100%-1.75rem)] px-2 py-1.5 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          {initial ? "Save changes" : "Create template"}
        </button>
      </div>
    </form>
  );
}

// ── "Start from template" form ─────────────────────────────────────────────────

function StartFromTemplateForm({
  template,
  onSave,
  onClose,
}: {
  template: Template;
  onSave: (data: { templateId: string; name: string; description: string; dueDate: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [dueDate, setDueDate] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ templateId: template.id, name, description, dueDate });
      }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Start New Checklist</h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="flex-1 px-6 py-5 space-y-4">
        <p className="text-xs text-gray-500">
          Starting from template: <span className="font-medium text-gray-700">{template.name}</span>
          {template.items.length > 0 && ` · ${template.items.length} tasks will be created`}
        </p>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Checklist name *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} resize-none`} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </div>
        <p className="text-xs text-gray-400">
          Task due dates are calculated from today using the offsets defined in the template. You can adjust them individually afterward.
        </p>
      </div>
      <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          Start checklist
        </button>
      </div>
    </form>
  );
}

// ── Active checklist detail view ───────────────────────────────────────────────

function ChecklistDetail({
  checklist,
  onEdit,
  onDelete,
}: {
  checklist: ChecklistDetail;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  const total = checklist.tasks.length;
  const done = checklist.tasks.filter(
    (t) => t.status === "done" || t.status === "skipped"
  ).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = total > 0 && done === total;
  const isOverdue = checklist.dueDate && checklist.dueDate < TODAY && !allDone;

  const toggleTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<ChecklistTask>(`/api/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const addTask = useMutation({
    mutationFn: (title: string) =>
      apiFetch<ChecklistTask>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          checklistId: checklist.id,
          priority: "medium",
          status: "todo",
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setNewTaskTitle("");
      setAddingTask(false);
    },
  });

  function handleToggle(task: ChecklistTask) {
    const isDone = task.status === "done" || task.status === "skipped";
    toggleTask.mutate({ id: task.id, status: isDone ? "todo" : "done" });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{checklist.name}</h2>
          {checklist.description && (
            <p className="text-sm text-gray-400 mt-0.5">{checklist.description}</p>
          )}
          {checklist.dueDate && (
            <p className={`text-xs mt-1 ${isOverdue ? "text-red-600 font-medium" : "text-gray-400"}`}>
              {isOverdue ? "Overdue · " : "Due "}
              {fmtDate(checklist.dueDate)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-shrink-0">
          <button onClick={onEdit} className="text-xs text-indigo-600 hover:underline font-medium">Edit</button>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      </div>

      {/* Progress */}
      {total > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{done} of {total} done{pct > 0 ? ` (${pct}%)` : ""}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${allDone ? "bg-green-500" : "bg-indigo-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto -mx-2 mb-3">
        {checklist.tasks.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-gray-400">No tasks yet. Add one below.</p>
          </div>
        ) : (
          checklist.tasks.map((task) => {
            const isDone = task.status === "done" || task.status === "skipped";
            const taskOverdue = task.dueDate && task.dueDate < TODAY && !isDone;
            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 px-4 py-2.5 rounded-lg mb-0.5 ${isDone ? "opacity-60" : "hover:bg-gray-50"}`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => handleToggle(task)}
                  className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors p-0.5 box-content ${
                    isDone ? "bg-indigo-600 border-indigo-600" : "border-gray-300 hover:border-indigo-400"
                  }`}
                >
                  {isDone && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                {/* Task content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${isDone ? "line-through text-gray-400" : "text-gray-900"}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
                  )}
                </div>
                {/* Priority + due date */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {task.dueDate && (
                    <span className={`text-xs ${taskOverdue ? "text-red-600 font-medium" : "text-gray-400"}`}>
                      {fmtDate(task.dueDate)}
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? ""}`}>
                    {task.priority}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {allDone && (
          <div className="mt-3 py-4 text-center">
            <p className="text-sm font-medium text-green-600">All done!</p>
          </div>
        )}
      </div>

      {/* Add task */}
      {addingTask ? (
        <div className="flex gap-2 mt-auto">
          <input
            autoFocus
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTaskTitle.trim()) addTask.mutate(newTaskTitle.trim());
              if (e.key === "Escape") { setAddingTask(false); setNewTaskTitle(""); }
            }}
            placeholder="Task title — press Enter to add"
            className={inputClass}
          />
          <button
            onClick={() => { setAddingTask(false); setNewTaskTitle(""); }}
            className="text-gray-400 hover:text-gray-600 px-2"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingTask(true)}
          className="mt-auto text-sm text-indigo-600 hover:text-indigo-700 font-medium text-left"
        >
          + Add task
        </button>
      )}
    </div>
  );
}

// ── Template detail view ───────────────────────────────────────────────────────

function TemplateDetail({
  template,
  onEdit,
  onDelete,
  onStart,
}: {
  template: Template;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{template.name}</h2>
          {template.description && (
            <p className="text-sm text-gray-400 mt-0.5">{template.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-shrink-0">
          <button onClick={onEdit} className="text-xs text-indigo-600 hover:underline font-medium">Edit</button>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      </div>

      {/* Item list */}
      {template.items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-gray-400">No tasks defined yet.</p>
            <button onClick={onEdit} className="mt-2 text-xs text-indigo-600 hover:underline">Add tasks</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto -mx-2 mb-5">
          {template.items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 rounded-lg">
              <div className="mt-1 w-5 h-5 flex-shrink-0 rounded border-2 border-gray-200" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-400">{offsetLabel(item.offsetDays)}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[item.priority] ?? ""}`}>
                  {item.priority}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Start button */}
      <button
        onClick={onStart}
        className="mt-auto w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
      >
        Start New Checklist from This Template
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type TabKey = "active" | "templates";

export default function ChecklistsPage() {
  const qc = useQueryClient();
  const location = useLocation();

  const [tab, setTab] = useState<TabKey>("active");
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Form states
  const [checklistFormOpen, setChecklistFormOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState<Checklist | null>(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [startFormOpen, setStartFormOpen] = useState(false);

  // ── Deep-link from Tasks page: navigate("/checklists", { state: { checklistId } })
  useEffect(() => {
    const id = location.state?.checklistId as string | undefined;
    if (id) {
      setTab("active");
      setSelectedChecklistId(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data queries ────────────────────────────────────────────────────────────

  const { data: checklists = [], isLoading: checklistsLoading } = useQuery({
    queryKey: ["checklists"],
    queryFn: () => apiFetch<Checklist[]>("/api/checklists"),
  });

  const { data: checklistDetail } = useQuery({
    queryKey: ["checklists", selectedChecklistId],
    queryFn: () => apiFetch<ChecklistDetail>(`/api/checklists/${selectedChecklistId}`),
    enabled: !!selectedChecklistId && tab === "active",
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["checklist-templates"],
    queryFn: () => apiFetch<Template[]>("/api/checklist-templates"),
  });

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createChecklist = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<Checklist>("/api/checklists", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      setChecklistFormOpen(false);
      setSelectedChecklistId(created.id);
    },
  });

  const updateChecklist = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch<Checklist>(`/api/checklists/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      qc.invalidateQueries({ queryKey: ["checklists", selectedChecklistId] });
      setChecklistFormOpen(false);
      setEditingChecklist(null);
    },
  });

  const deleteChecklist = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/checklists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      setSelectedChecklistId(null);
    },
  });

  const createTemplate = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<Template>("/api/checklist-templates", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["checklist-templates"] });
      setTemplateFormOpen(false);
      setSelectedTemplateId(created.id);
    },
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch<Template>(`/api/checklist-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklist-templates"] });
      setTemplateFormOpen(false);
      setEditingTemplate(null);
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/checklist-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checklist-templates"] });
      setSelectedTemplateId(null);
    },
  });

  const startFromTemplate = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<ChecklistDetail>("/api/checklists/from-template", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["checklists"] });
      setStartFormOpen(false);
      setTab("active");
      setSelectedChecklistId(created.id);
    },
  });

  // ── Derived state ───────────────────────────────────────────────────────────

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  // ── Render helpers ──────────────────────────────────────────────────────────

  function activeLeftPanel() {
    if (checklistsLoading) {
      return (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (checklists.length === 0) {
      return (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-gray-400">No checklists yet.</p>
          <button onClick={() => { setEditingChecklist(null); setChecklistFormOpen(true); }} className="mt-2 text-xs text-indigo-600 hover:underline">
            Create one
          </button>
        </div>
      );
    }
    return checklists.map((cl) => {
      const isSelected = cl.id === selectedChecklistId;
      const pct = cl.taskCount === 0 ? 0 : Math.round((cl.doneCount / cl.taskCount) * 100);
      const overdue = cl.dueDate && cl.dueDate < TODAY && cl.status === "active" && cl.doneCount < cl.taskCount;
      return (
        <button
          key={cl.id}
          onClick={() => setSelectedChecklistId(cl.id === selectedChecklistId ? null : cl.id)}
          className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? "bg-indigo-50 border-r-2 border-indigo-600" : "hover:bg-white"}`}
        >
          <p className={`text-sm font-medium truncate ${isSelected ? "text-indigo-900" : "text-gray-900"}`}>
            {cl.name}
          </p>
          <p className={`text-xs mt-0.5 ${overdue ? "text-red-500" : "text-gray-400"}`}>
            {cl.doneCount}/{cl.taskCount} done
            {overdue && " · overdue"}
            {cl.dueDate && !overdue && ` · due ${fmtDate(cl.dueDate)}`}
          </p>
          {cl.taskCount > 0 && (
            <div className="mt-1.5 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-indigo-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </button>
      );
    });
  }

  function templatesLeftPanel() {
    if (templatesLoading) {
      return (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (templates.length === 0) {
      return (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-gray-400">No templates yet.</p>
          <button onClick={() => { setEditingTemplate(null); setTemplateFormOpen(true); }} className="mt-2 text-xs text-indigo-600 hover:underline">
            Create one
          </button>
        </div>
      );
    }
    return templates.map((t) => {
      const isSelected = t.id === selectedTemplateId;
      return (
        <button
          key={t.id}
          onClick={() => setSelectedTemplateId(t.id === selectedTemplateId ? null : t.id)}
          className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? "bg-indigo-50 border-r-2 border-indigo-600" : "hover:bg-white"}`}
        >
          <p className={`text-sm font-medium truncate ${isSelected ? "text-indigo-900" : "text-gray-900"}`}>
            {t.name}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {t.items.length} task{t.items.length !== 1 ? "s" : ""}
          </p>
        </button>
      );
    });
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left panel ──────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        {/* Tabs */}
        <div className="px-3 pt-3 pb-2 border-b border-gray-200">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(["active", "templates"] as TabKey[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                  tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "active" ? "Active" : "Templates"}
              </button>
            ))}
          </div>
        </div>

        {/* New button */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex justify-end">
          {tab === "active" ? (
            <button
              onClick={() => { setEditingChecklist(null); setChecklistFormOpen(true); }}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              + New checklist
            </button>
          ) : (
            <button
              onClick={() => { setEditingTemplate(null); setTemplateFormOpen(true); }}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              + New template
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {tab === "active" ? activeLeftPanel() : templatesLeftPanel()}
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "active" && (
          checklistDetail ? (
            <ChecklistDetail
              checklist={checklistDetail}
              onEdit={() => {
                setEditingChecklist(checklists.find((c) => c.id === checklistDetail.id) ?? null);
                setChecklistFormOpen(true);
              }}
              onDelete={() => {
                if (confirm(`Delete "${checklistDetail.name}"? Its tasks will become standalone tasks.`)) {
                  deleteChecklist.mutate(checklistDetail.id);
                }
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-gray-400">
                  {checklists.length === 0
                    ? "Create your first checklist to get started."
                    : "Select a checklist to work through it."}
                </p>
                {checklists.length === 0 && (
                  <button
                    onClick={() => { setEditingChecklist(null); setChecklistFormOpen(true); }}
                    className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                  >
                    + New checklist
                  </button>
                )}
              </div>
            </div>
          )
        )}

        {tab === "templates" && (
          selectedTemplate ? (
            <TemplateDetail
              template={selectedTemplate}
              onEdit={() => { setEditingTemplate(selectedTemplate); setTemplateFormOpen(true); }}
              onDelete={() => {
                if (confirm(`Delete template "${selectedTemplate.name}"?`)) {
                  deleteTemplate.mutate(selectedTemplate.id);
                }
              }}
              onStart={() => setStartFormOpen(true)}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-gray-400">
                  {templates.length === 0
                    ? "Templates let you define a set of tasks once and reuse them."
                    : "Select a template to view or start it."}
                </p>
                {templates.length === 0 && (
                  <button
                    onClick={() => { setEditingTemplate(null); setTemplateFormOpen(true); }}
                    className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                  >
                    + New template
                  </button>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Slide-overs ─────────────────────────────────────────────── */}

      {/* Checklist create / edit */}
      <SlideOver open={checklistFormOpen} onClose={() => { setChecklistFormOpen(false); setEditingChecklist(null); }}>
        <ChecklistForm
          initial={editingChecklist ?? undefined}
          onSave={(data) => {
            if (editingChecklist) {
              updateChecklist.mutate({ id: editingChecklist.id, data });
            } else {
              createChecklist.mutate(data);
            }
          }}
          onClose={() => { setChecklistFormOpen(false); setEditingChecklist(null); }}
        />
      </SlideOver>

      {/* Template create / edit */}
      <SlideOver open={templateFormOpen} onClose={() => { setTemplateFormOpen(false); setEditingTemplate(null); }}>
        <TemplateForm
          initial={editingTemplate ?? undefined}
          onSave={(data) => {
            if (editingTemplate) {
              updateTemplate.mutate({ id: editingTemplate.id, data });
            } else {
              createTemplate.mutate(data);
            }
          }}
          onClose={() => { setTemplateFormOpen(false); setEditingTemplate(null); }}
        />
      </SlideOver>

      {/* Start from template */}
      {selectedTemplate && (
        <SlideOver open={startFormOpen} onClose={() => setStartFormOpen(false)}>
          <StartFromTemplateForm
            template={selectedTemplate}
            onSave={(data) => startFromTemplate.mutate(data)}
            onClose={() => setStartFormOpen(false)}
          />
        </SlideOver>
      )}
    </div>
  );
}
