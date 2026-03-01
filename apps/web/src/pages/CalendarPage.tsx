// CalendarPage — month grid view with event management.
//
// Shows a standard month calendar. Each day cell displays colored pills
// for events (using the event type's color from the seed data).
// Click any day to view its events. Use the slide-over to add/edit events.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type EventStatus = "scheduled" | "confirmed" | "completed" | "cancelled";

interface CalendarEvent {
  id: string;
  title: string;
  eventTypeId?: string | null;
  startAt: string;  // ISO datetime or date
  endAt?: string | null;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  status: EventStatus;
}

interface EventType {
  id: string;
  name: string;
  color?: string | null;
  category?: string | null;
}

interface EventFormData {
  title: string;
  eventTypeId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  description: string;
  status: EventStatus;
}

// ── API calls ──────────────────────────────────────────────────────────────────

const calApi = {
  eventTypes: () => apiFetch<EventType[]>("/api/event-types"),
  listEvents: (from: string, to: string) =>
    apiFetch<CalendarEvent[]>(`/api/events?from=${from}&to=${to}`),
  createEvent: (data: object) =>
    apiFetch<CalendarEvent>("/api/events", { method: "POST", body: JSON.stringify(data) }),
  updateEvent: (id: string, data: object) =>
    apiFetch<CalendarEvent>(`/api/events/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEvent: (id: string) =>
    apiFetch<void>(`/api/events/${id}`, { method: "DELETE" }),
};

// ── Calendar math helpers ──────────────────────────────────────────────────────

function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);

  // Start grid on Monday (ISO week)
  const startOffset = (firstDay.getDay() + 6) % 7; // 0=Mon, 6=Sun
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startOffset);

  // Always show 6 weeks (42 days) for consistent grid height
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eventDateKey(event: CalendarEvent): string {
  return event.startAt.slice(0, 10);
}

// ── Form helpers ───────────────────────────────────────────────────────────────

function eventToForm(event: CalendarEvent): EventFormData {
  const startDate = event.startAt.slice(0, 10);
  const startTime = event.startAt.length > 10 ? event.startAt.slice(11, 16) : "09:00";
  const endDate = event.endAt ? event.endAt.slice(0, 10) : startDate;
  const endTime = event.endAt && event.endAt.length > 10 ? event.endAt.slice(11, 16) : "10:00";
  return {
    title: event.title,
    eventTypeId: event.eventTypeId ?? "",
    startDate,
    startTime,
    endDate,
    endTime,
    allDay: event.allDay,
    location: event.location ?? "",
    description: event.description ?? "",
    status: event.status,
  };
}

function formToPayload(form: EventFormData) {
  const startAt = form.allDay
    ? form.startDate
    : `${form.startDate}T${form.startTime}:00`;
  const endAt =
    form.endDate
      ? form.allDay
        ? form.endDate
        : `${form.endDate}T${form.endTime}:00`
      : undefined;

  return {
    title: form.title,
    eventTypeId: form.eventTypeId || undefined,
    startAt,
    endAt,
    allDay: form.allDay,
    location: form.location || undefined,
    description: form.description || undefined,
    status: form.status,
  };
}

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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>
    </div>
  );
}

function EventForm({
  initial,
  eventTypes,
  onSave,
  onCancel,
  onDelete,
  isPending,
  error,
  isEditing,
}: {
  initial: EventFormData;
  eventTypes: EventType[];
  onSave: (data: EventFormData) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isPending: boolean;
  error?: string;
  isEditing: boolean;
}) {
  const [form, setForm] = useState<EventFormData>(initial);

  function set<K extends keyof EventFormData>(field: K, value: EventFormData[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const inputClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400";
  const selectClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  // Find selected event type for color preview
  const selectedType = eventTypes.find((t) => t.id === form.eventTypeId);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      className="flex flex-col h-full"
    >
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. BookCon 2026"
            required
            autoFocus
            className={inputClass}
          />
        </div>

        {/* Event type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Event type</label>
          <div className="flex items-center gap-2">
            {selectedType?.color && (
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedType.color }}
              />
            )}
            <select
              value={form.eventTypeId}
              onChange={(e) => set("eventTypeId", e.target.value)}
              className={selectClass}
            >
              <option value="">— None —</option>
              {eventTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* All day toggle */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="allDay"
            checked={form.allDay}
            onChange={(e) => set("allDay", e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="allDay" className="text-sm text-gray-700 select-none cursor-pointer">
            All-day event
          </label>
        </div>

        {/* Start */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Start <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              required
              className={inputClass}
            />
            {!form.allDay && (
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                className={inputClass}
              />
            )}
          </div>
        </div>

        {/* End */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">End</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              className={inputClass}
            />
            {!form.allDay && (
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                className={inputClass}
              />
            )}
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Location</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder="e.g. Convention Center, Hall B"
            className={inputClass}
          />
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value as EventStatus)} className={selectClass}>
            <option value="scheduled">Scheduled</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Optional notes"
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
            disabled={isPending || !form.title || !form.startDate}
            className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? "Saving…" : "Save event"}
          </button>
        </div>
        {isEditing && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="w-full py-2 px-4 text-red-600 hover:text-red-800 text-xs font-medium"
          >
            Delete this event
          </button>
        )}
      </div>
    </form>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_HEADERS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TODAY_STR = new Date().toISOString().slice(0, 10);

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(TODAY_STR);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newEventDate, setNewEventDate] = useState(TODAY_STR);

  // The month grid (42 days)
  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);
  const fromDate = toISODate(grid[0]);
  const toDate = toISODate(grid[41]);

  const { data: eventTypes = [] } = useQuery({
    queryKey: ["event-types"],
    queryFn: calApi.eventTypes,
  });

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", fromDate, toDate],
    queryFn: () => calApi.listEvents(fromDate, toDate),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
  };

  const createMutation = useMutation({
    mutationFn: calApi.createEvent,
    onSuccess: () => { invalidate(); setAddingNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => calApi.updateEvent(id, data),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: calApi.deleteEvent,
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  // Index events by date for fast O(1) lookup
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      const key = eventDateKey(ev);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [events]);

  // Event type lookup
  const typeMap = useMemo(
    () => Object.fromEntries(eventTypes.map((t) => [t.id, t])),
    [eventTypes]
  );

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function openAdd(date: string) {
    setNewEventDate(date);
    setEditing(null);
    setAddingNew(true);
  }

  function openEdit(event: CalendarEvent) {
    setEditing(event);
    setAddingNew(false);
  }

  function handleSave(form: EventFormData) {
    const payload = formToPayload(form);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const panelOpen = addingNew || editing !== null;
  const mutationError =
    (createMutation.error as Error)?.message ??
    (updateMutation.error as Error)?.message;
  const mutationPending = createMutation.isPending || updateMutation.isPending;

  const formInitial: EventFormData = editing
    ? eventToForm(editing)
    : {
        title: "",
        eventTypeId: "",
        startDate: newEventDate,
        startTime: "09:00",
        endDate: newEventDate,
        endTime: "10:00",
        allDay: false,
        location: "",
        description: "",
        status: "scheduled",
      };

  // Events for the selected day (right panel)
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] ?? []) : [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900">
            {MONTH_NAMES[month]} {year}
          </h1>
          <div className="flex gap-1">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            >
              ‹
            </button>
            <button
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            >
              ›
            </button>
          </div>
          <button
            onClick={() => {
              const n = new Date();
              setYear(n.getFullYear());
              setMonth(n.getMonth());
              setSelectedDay(TODAY_STR);
            }}
            className="text-sm text-indigo-600 hover:underline font-medium"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => openAdd(selectedDay ?? TODAY_STR)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New event
        </button>
      </div>

      <div className="flex gap-6">
        {/* Month grid */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAY_HEADERS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium text-gray-500">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {grid.map((date, i) => {
              const dateStr = toISODate(date);
              const isCurrentMonth = date.getMonth() === month;
              const isToday = dateStr === TODAY_STR;
              const isSelected = dateStr === selectedDay;
              const dayEvents = eventsByDate[dateStr] ?? [];
              const showBorder = i < 35; // no bottom border on last row

              return (
                <div
                  key={dateStr}
                  onClick={() => setSelectedDay(dateStr)}
                  onDoubleClick={() => openAdd(dateStr)}
                  className={`min-h-[88px] p-1.5 cursor-pointer transition-colors ${
                    showBorder ? "border-b border-gray-100" : ""
                  } ${i % 7 !== 6 ? "border-r border-gray-100" : ""} ${
                    isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                  }`}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday
                          ? "bg-indigo-600 text-white"
                          : isCurrentMonth
                          ? "text-gray-900"
                          : "text-gray-300"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayEvents.length > 0 && isCurrentMonth && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openAdd(dateStr); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-600 text-xs leading-none"
                      >
                        +
                      </button>
                    )}
                  </div>

                  {/* Event pills */}
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const evType = ev.eventTypeId ? typeMap[ev.eventTypeId] : null;
                      const color = evType?.color ?? "#6366f1";
                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                          className="px-1.5 py-0.5 rounded text-xs font-medium truncate cursor-pointer hover:opacity-80 transition-opacity"
                          style={{
                            backgroundColor: color + "22",  // 13% opacity
                            color,
                            borderLeft: `2px solid ${color}`,
                          }}
                        >
                          {ev.allDay
                            ? ev.title
                            : `${ev.startAt.slice(11, 16)} ${ev.title}`}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div className="text-xs text-gray-400 px-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {selectedDay
                  ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })
                  : "Select a day"}
              </h3>
              {selectedDay && (
                <button
                  onClick={() => openAdd(selectedDay)}
                  className="text-indigo-600 text-xs font-medium hover:underline"
                >
                  + Add
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="py-6 flex justify-center">
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : selectedEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                {selectedDay ? "No events" : ""}
              </p>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((ev) => {
                  const evType = ev.eventTypeId ? typeMap[ev.eventTypeId] : null;
                  const color = evType?.color ?? "#6366f1";
                  return (
                    <button
                      key={ev.id}
                      onClick={() => openEdit(ev)}
                      className="w-full text-left rounded-lg p-2.5 hover:bg-gray-50 transition-colors"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {ev.title}
                      </div>
                      {evType && (
                        <div className="text-xs text-gray-400 mt-0.5">{evType.name}</div>
                      )}
                      {!ev.allDay && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {ev.startAt.slice(11, 16)}
                          {ev.endAt ? ` – ${ev.endAt.slice(11, 16)}` : ""}
                        </div>
                      )}
                      {ev.location && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">
                          📍 {ev.location}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-over */}
      <SlideOver
        open={panelOpen}
        title={editing ? "Edit event" : "New event"}
        onClose={() => { setEditing(null); setAddingNew(false); }}
      >
        <EventForm
          key={editing?.id ?? `new-${newEventDate}`}
          initial={formInitial}
          eventTypes={eventTypes}
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
