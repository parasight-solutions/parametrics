import { Loader2 } from "lucide-react";

export default function DataTable({ tableHeading, tableBody, loading }) {
  return (
    <div className="w-full overflow-hidden border border-[#E2E8F0] rounded-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* Header */}
          <thead className="bg-[#F2F4F6] border-b border-[#C3C6D7]">
            <tr>
              {tableHeading?.map((h, index) => (
                <th
                  key={`heading-${index}`}
                  className="px-5 py-4 text-left font-semibold text-[#64748B] whitespace-nowrap"
                >
                  {h?.label}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody className="divide-y divide-[#C3C6D7]">
            {/* Loading State */}
            {loading ? (
              <tr>
                <td
                  colSpan={tableHeading?.length}
                  className="py-12 text-center"
                >
                  <div className="flex items-center justify-center gap-2 text-[#64748B]">
                    <Loader2 size={20} className="animate-spin" />
                    Loading data...
                  </div>
                </td>
              </tr>
            ) : tableBody?.length > 0 ? (
              tableBody.map((row, rowIndex) => (
                <tr
                  key={`row-${rowIndex}`}
                  className="hover:bg-gray-50 transition-colors"
                >
                  {row?.cells?.map((c, cellIndex) => (
                    <td
                      key={`cell-${cellIndex}`}
                      className="px-5 py-4 text-left whitespace-nowrap"
                    >
                      {c ?? "-"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              /* Empty State */
              <tr>
                <td
                  colSpan={tableHeading?.length}
                  className="text-center py-12 text-[#64748B]"
                >
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
