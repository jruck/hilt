"use client";

import { useMemo } from "react";

interface CSVTableViewerProps {
  filePath?: string; // Kept for API consistency, not currently used
  content: string;
}

// Simple CSV parser that handles quoted fields
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
        currentRow.push(currentField.trim());
        if (currentRow.length > 0 && currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        if (char === "\r") i++; // Skip \n in \r\n
      } else if (char !== "\r") {
        currentField += char;
      }
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function CSVTableViewer({ content }: CSVTableViewerProps) {
  const { headers, rows } = useMemo(() => {
    const allRows = parseCSV(content);
    if (allRows.length === 0) {
      return { headers: [], rows: [] };
    }
    return {
      headers: allRows[0],
      rows: allRows.slice(1),
    };
  }, [content]);

  if (headers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p className="text-sm">Empty CSV file</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 pb-4">
      {/* Stats centered at top */}
      <div className="text-center text-xs text-[var(--text-tertiary)] py-3">
        {rows.length} row{rows.length !== 1 ? "s" : ""} × {headers.length} column{headers.length !== 1 ? "s" : ""}
      </div>

      {/* Table with sticky header and scroll mask */}
      <div className="relative">
        {/* Mask to hide content scrolling above sticky header */}
        <div className="sticky top-0 z-20 h-0">
          <div className="absolute -top-4 left-0 right-0 h-4 bg-[var(--bg-primary)]" />
        </div>

        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--bg-secondary)]">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-medium text-[var(--text-primary)] border-b border-[var(--border-default)] whitespace-nowrap"
                >
                  {header || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {headers.map((_, colIndex) => (
                  <td
                    key={colIndex}
                    className="px-3 py-2 text-[var(--text-secondary)] border-b border-[var(--border-default)] max-w-xs truncate"
                    title={row[colIndex] || ""}
                  >
                    {row[colIndex] || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
