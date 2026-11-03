import { useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { inputClass } from "../../utils/getInputClass";

export default function CustomInputPassword({
  icon,
  error,
  className,
  ...props
}) {
  const Icon = icon;

  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={showPassword ? "text" : "password"}
        className={`${Icon && "pl-9"} ${className} ${inputClass(error)}`}
      />

      <Icon
        size={16}
        className="absolute top-1/2 -translate-y-1/2 left-3"
        color="#717781"
      />

      <button type="button" onClick={() => setShowPassword((prev) => !prev)}>
        {showPassword ? (
          <EyeOff
            size={16}
            className="absolute top-1/2 -translate-y-1/2 right-4"
            color="#717781"
          />
        ) : (
          <Eye
            size={16}
            className="absolute top-1/2 -translate-y-1/2 right-4"
            color="#717781"
          />
        )}
      </button>
    </div>
  );
}
