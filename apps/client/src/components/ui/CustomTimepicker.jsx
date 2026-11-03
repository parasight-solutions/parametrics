import { Timer } from "lucide-react";

import { inputClass } from "../../utils/getInputClass";

export default function CustomTimepicker({
  icon = Timer,
  error,
  className,
  ...props
}) {
  const Icon = icon;

  return (
    <div className="relative">
      <input
        {...props}
        type="time"
        onClick={(e) => e.currentTarget.showPicker()}
        className={`${Icon && "pl-9"} ${className} ${inputClass(error)} [&::-webkit-calendar-picker-indicator]:hidden appearance-none`}
      />

      {Icon && (
        <Icon
          size={18}
          className="absolute top-1/2 -translate-y-1/2 left-3"
          color="#717781"
        />
      )}
    </div>
  );
}
