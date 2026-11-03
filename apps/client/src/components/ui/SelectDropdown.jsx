import { useEffect, useId, useRef, useState } from "react";

import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";
import { ChevronDown, Search, X } from "lucide-react";

import CustomInput from "./CustomInput";

import { inputClass } from "../../utils/getInputClass";

export default function SelectDropdown({
  id,
  options,
  selectedOptions = [],
  placeholder,
  isSelected,
  onSelect,
  multiple = false,
  allowClear = false,
  onClear,
  error,
  disabled = false,
  required = false,
  className = "",
  onBlur,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  const generatedId = useId();
  const listboxId = id ? `${id}-listbox` : `${generatedId}-listbox`;

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions = normalizedSearchQuery
    ? options.filter((option) =>
        String(option.label).toLowerCase().includes(normalizedSearchQuery),
      )
    : options;

  const hasSelection = selectedOptions.length > 0;
  const showClear =
    allowClear && !multiple && hasSelection && !normalizedSearchQuery;

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      if (disabled) return;

      setIsOpen(open);

      if (!open) setSearchQuery("");
    },
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(5),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements, rects }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: `${Math.max(80, Math.min(240, availableHeight))}px`,
          });
        },
      }),
    ],
  });

  // useClick adds Enter/Space handling for non-button references automatically.
  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  const handleSelect = (optionValue) => {
    onSelect(optionValue);
    setSearchQuery("");

    if (!multiple) {
      setIsOpen(false);
      refs.domReference.current?.focus();
    } else {
      searchInputRef.current?.focus();
    }
  };

  const handleRemove = (event, optionValue) => {
    event.stopPropagation();
    if (disabled) return;
    onSelect(optionValue);
  };

  const handleClear = () => {
    onClear?.();
    setSearchQuery("");
    setIsOpen(false);
    refs.domReference.current?.focus();
  };

  return (
    <>
      <div
        ref={(node) => refs.setReference(node)}
        {...getReferenceProps({
          id,
          role: "combobox",
          tabIndex: disabled ? -1 : 0,
          onBlur,
          "aria-controls": listboxId,
          "aria-expanded": isOpen,
          "aria-haspopup": "listbox",
          "aria-invalid": error ? true : undefined,
          "aria-required": required || undefined,
          "aria-disabled": disabled || undefined,
        })}
        className={`${inputClass(error)} ${className} ${
          multiple ? "h-auto min-h-10" : ""
        } flex items-center justify-between gap-3 text-left ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        {multiple ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            {hasSelection ? (
              selectedOptions.map((option) => (
                <span
                  key={option.value}
                  className="flex max-w-full items-center gap-1 rounded bg-gray-200 py-0.5 pr-1 pl-2 text-xs"
                >
                  <span className="truncate">{option.label}</span>
                  <button
                    type="button"
                    tabIndex={disabled ? -1 : 0}
                    disabled={disabled}
                    aria-label={`Remove ${option.label}`}
                    onClick={(event) => handleRemove(event, option.value)}
                    className="shrink-0 rounded p-0.5 hover:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))
            ) : (
              <span className="text-[#C1C7D1]">
                {placeholder || "Select an option"}
              </span>
            )}
          </div>
        ) : (
          <span
            className={`min-w-0 flex-1 truncate ${
              hasSelection ? "text-black" : "text-[#C1C7D1]"
            }`}
          >
            {selectedOptions[0]?.label || placeholder || "Select an option"}
          </span>
        )}

        <ChevronDown
          aria-hidden="true"
          size={18}
          className={`shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {isOpen && !disabled && (
        <FloatingPortal>
          <div
            ref={(node) => refs.setFloating(node)}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-10000 flex flex-col overflow-hidden rounded-md border border-[#C3C6D7] bg-white shadow-md"
          >
            <div className="relative shrink-0 border-b border-[#C3C6D7] p-2">
              <CustomInput
                ref={searchInputRef}
                icon={Search}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search options"
                placeholder="Search options..."
                className={inputClass()}
              />
            </div>

            <div
              id={listboxId}
              role="listbox"
              aria-multiselectable={multiple || undefined}
              className="min-h-0 flex flex-1 flex-col gap-1 overflow-y-auto p-1"
            >
              {showClear && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-full rounded px-3 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-200"
                >
                  Clear selection
                </button>
              )}

              {filteredOptions.length ? (
                filteredOptions.map((option) => {
                  const selected = isSelected(option.value);

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={option.disabled}
                      onClick={() => handleSelect(option.value)}
                      className={`w-full rounded px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "bg-gray-200 font-medium"
                          : "hover:bg-gray-200"
                      }`}
                    >
                      {option.label}{" "}
                      {selected && <span aria-hidden="true">✔</span>}
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-sm">
                  {options.length ? "No options found" : "No options available"}
                </p>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
