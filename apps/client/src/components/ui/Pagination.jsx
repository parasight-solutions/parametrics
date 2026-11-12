import { Grid } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ currentPage, totalPages, onPageChange }) {
  // <!---------------------------------------- (Context) --------------------------------------------!>
  const screens = Grid.useBreakpoint();

  const maxPageButtons = screens.md ? 10 : screens.sm ? 5 : 3;

  if (totalPages <= 1) return null;

  let startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
  let endPage = startPage + maxPageButtons - 1;

  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxPageButtons + 1);
  }

  const pageNumbers = [];
  for (let i = startPage; i <= endPage; i++) pageNumbers.push(i);

  return (
    <div className="flex justify-center mt-4 gap-2 text-[14px]">
      {/* Prev Button */}
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        className={`px-3 py-1 bg-gray-200 rounded ${
          currentPage !== 1 && `hover:bg-gray-300`
        }`}
        disabled={currentPage === 1}
      >
        <ChevronLeft size={18} />
      </button>

      {startPage > 1 && (
        <>
          <button
            type="button"
            onClick={() => onPageChange(1)}
            className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
          >
            1
          </button>
          {startPage > 2 && <span className="px-2">...</span>}
        </>
      )}

      {/* Page numbers */}
      {pageNumbers.map((num) => (
        <button
          type="button"
          key={num}
          onClick={() => onPageChange(num)}
          className={`px-3 py-1 rounded ${
            currentPage === num
              ? `bg-[#7851A9] text-white`
              : `bg-gray-200 hover:bg-gray-300`
          }`}
        >
          {num}
        </button>
      ))}

      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && <span className="px-2">...</span>}
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
          >
            {totalPages}
          </button>
        </>
      )}

      {/* Next Button */}
      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        className={`px-3 py-1 bg-gray-200 rounded ${
          currentPage !== totalPages && `hover:bg-gray-300`
        }`}
        disabled={currentPage === totalPages}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
