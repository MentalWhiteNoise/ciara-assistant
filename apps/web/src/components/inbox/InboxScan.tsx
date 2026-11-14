// InboxScan — read-only diagnostic listing one service's emails in the shared
// reports inbox, including old ones forwarded as attached .eml files.
// Used to see what a service actually sends before (or while) importing it.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types (mirror apps/api/src/connectors/gmail/scan.ts) ──────────────────────

interface ScannedEmail {
  source: "direct" | "attached";
  wrapperSubject: string | null;
  messageId: string | null;
  date: string | null;
  from: string;
  subject: string;
  subjectPattern: string;
  attachments: { filename: string; contentType: string; size: number; sha256: string }[];
  savedTo: string | null;
}

interface ScanResult {
  service: string;
  mailbox: string;
  mailboxMessages: number;
  matchedMessages: number;
  truncated: boolean;
  emails: ScannedEmail[];
  duplicates: number;
  otherAttachedEmails: { date: string | null; from: string; subject: string; wrapperSubject: string | null }[];
  patterns: { subjectPattern: string; from: string; count: number; first: string | null; last: string | null; attachmentTypes: string[] }[];
  saved: number;
  saveDir: string | null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

interface Props {
  /** Server-side service key, e.g. "ingramspark" or "48hr_books". */
  service: string;
  /** Display name, e.g. "IngramSpark". */
  label: string;
  /** Where "save copies" writes, shown to the user. */
  folder: string;
  /** Start expanded (for services with no importer yet). */
  defaultOpen?: boolean;
}

export function InboxScan({ service, label, folder, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [result, setResult] = useState<ScanResult | null>(null);
  const scan = useMutation({
    mutationFn: (save: boolean) =>
      apiFetch<ScanResult>("/api/inbox/scan", { method: "POST", body: JSON.stringify({ service, save }) }),
    onSuccess: setResult,
  });

  return (
    <section className="rounded-lg border border-gray-200 p-4 space-y-3">
      <button onClick={() => setOpen(!open)} className="text-sm font-semibold text-gray-900">
        {open ? "▾" : "▸"} Inbox scan (diagnostic)
      </button>
      {open && (
        <>
          <p className="text-xs text-gray-500">
            Lists every {label} email in the reports inbox, including old ones forwarded as attached emails. Gmail is
            opened read-only — nothing is changed or marked as read. "Scan" saves nothing; "Scan &amp; save copies"
            also keeps a copy of each {label} email (and only those) on this computer ({folder}). Nothing is imported.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => scan.mutate(false)}
              disabled={scan.isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50"
            >
              {scan.isPending ? "Scanning…" : "Scan inbox"}
            </button>
            <button
              onClick={() => scan.mutate(true)}
              disabled={scan.isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50"
            >
              Scan &amp; save copies
            </button>
          </div>
          {scan.isError && <p className="text-sm text-red-600">{(scan.error as Error).message}</p>}
          {result && <ScanReport result={result} />}
        </>
      )}
    </section>
  );
}

function ScanReport({ result }: { result: ScanResult }) {
  const fromWrappers = result.emails.filter((e) => e.source === "attached").length;
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-700">
        Searched <b>{result.mailbox}</b> ({result.mailboxMessages} messages): {result.matchedMessages} matched. Found{" "}
        <b>{result.emails.length}</b> {result.service} email(s) — {fromWrappers} inside forwarded attachments,{" "}
        {result.emails.length - fromWrappers} direct.
        {result.duplicates > 0 && ` ${result.duplicates} duplicate(s) skipped.`}
        {result.truncated && " Only the newest 500 matching messages were scanned."}
        {result.saveDir && ` Saved ${result.saved} to ${result.saveDir}.`}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-3">Subject pattern</th>
              <th className="py-1 pr-3">From</th>
              <th className="py-1 pr-3">Count</th>
              <th className="py-1 pr-3">First – last</th>
              <th className="py-1">Attachments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.patterns.map((p) => (
              <tr key={p.from + p.subjectPattern}>
                <td className="py-1 pr-3">{p.subjectPattern || "(no subject)"}</td>
                <td className="py-1 pr-3 text-gray-600">{p.from}</td>
                <td className="py-1 pr-3">{p.count}</td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  {day(p.first)} – {day(p.last)}
                </td>
                <td className="py-1">{p.attachmentTypes.join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Subject</th>
              <th className="py-1 pr-3">Found</th>
              <th className="py-1">Attachments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.emails.map((e, i) => (
              <tr key={(e.messageId ?? "") + i}>
                <td className="py-1 pr-3 whitespace-nowrap">{day(e.date)}</td>
                <td className="py-1 pr-3">{e.subject}</td>
                <td className="py-1 pr-3 text-gray-600">{e.source === "attached" ? "in forwarded email" : "direct"}</td>
                <td className="py-1">
                  {e.attachments.length === 0
                    ? "none"
                    : e.attachments.map((a) => `${a.filename} (${kb(a.size)})`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.otherAttachedEmails.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-gray-900">
            Other attached emails (not from {result.service} — not saved)
          </h3>
          <ul className="text-sm text-gray-600 list-disc pl-5">
            {result.otherAttachedEmails.map((e, i) => (
              <li key={i}>
                {day(e.date)} — {e.from}: {e.subject}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
