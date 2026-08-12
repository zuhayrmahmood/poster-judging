/** Minimal RFC 4180 CSV writer — enough for the two admin exports, no dependency. */

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Quote when the value contains a delimiter, a quote, or any newline; double up
  // embedded quotes. Poster titles routinely contain commas.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  // CRLF and a UTF-8 BOM so Excel opens accented presenter names correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
