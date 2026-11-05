export default function CustomRadioButtons({
  id,
  name,
  value,
  options = [],
  onChange,
  className = "",
  disabled = false,
  ...props
}) {
  const groupName = name || id;

  return (
    <div className={`flex items-center gap-4 mt-2 ${className}`}>
      {options.map((option) => {
        const inputId = `${id}-${option.value}`;

        return (
          <div key={option.value} className="flex items-center gap-1">
            <input
              {...props}
              id={inputId}
              name={groupName}
              type="radio"
              value={option.value}
              checked={String(value) === String(option.value)}
              onChange={() => onChange?.(option.value, option)}
              disabled={disabled || option.disabled}
              className="accent-[#7851A9] cursor-pointer disabled:cursor-not-allowed"
            />

            <label htmlFor={inputId} className="text-sm cursor-pointer">
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}
