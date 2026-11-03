import SelectDropdown from "./SelectDropdown";

export default function CustomMultiSelect({
  options = [],
  error,
  value = [],
  onChange,
  placeholder,
  className = "",
  id,
  name,
  disabled = false,
  required = false,
  onBlur,
  ...props
}) {
  const selectedValues = Array.isArray(value) ? value : [];
  const selectedValueKeys = new Set(selectedValues.map(String));
  const selectedOptions = options.filter((option) =>
    selectedValueKeys.has(String(option.value)),
  );

  const toggleOption = (optionValue) => {
    const optionKey = String(optionValue);
    const option =
      options.find((opt) => String(opt.value) === optionKey) || null;
    const wasSelected = selectedValueKeys.has(optionKey);

    const nextValue = wasSelected
      ? selectedValues.filter((item) => String(item) !== optionKey)
      : [...selectedValues, optionValue];

    const nextOptions = wasSelected
      ? selectedOptions.filter((opt) => String(opt.value) !== optionKey)
      : [...selectedOptions, option];

    // value: the new array of raw values (for field.onChange)
    // option: the option that was just toggled, with an `added` flag
    // options: the new array of full option objects, for convenience
    onChange?.(nextValue, { ...option, added: !wasSelected }, nextOptions);
  };

  return (
    <div className="relative w-full">
      <SelectDropdown
        id={id}
        options={options}
        selectedOptions={selectedOptions}
        placeholder={placeholder}
        isSelected={(optionValue) => selectedValueKeys.has(String(optionValue))}
        onSelect={toggleOption}
        multiple
        error={error}
        disabled={disabled}
        required={required}
        className={className}
        onBlur={onBlur}
      />

      <select
        {...props}
        name={name}
        multiple
        value={selectedValues}
        disabled={disabled}
        required={required}
        onChange={() => {}}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
