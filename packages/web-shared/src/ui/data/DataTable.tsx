import type { ReactNode, CSSProperties } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  width?: string | number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "No data.",
  onRowClick,
  className = "",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        className={["card", className].filter(Boolean).join(" ")}
        style={{
          padding: "48px 24px",
          textAlign: "center",
          borderStyle: "dashed",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        {empty}
      </div>
    );
  }

  return (
    <div className={["tbl-wrap", className].filter(Boolean).join(" ")}>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={col.numeric ? "num" : undefined}
                  style={col.width != null ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowStyle: CSSProperties = onRowClick
                ? { cursor: "pointer" }
                : {};
              return (
                <tr
                  key={row.id}
                  style={rowStyle}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={col.numeric ? "num" : undefined}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
