import { inputClass } from "../../utils/getInputClass";

export default function CustomInput({ icon, error, className, ...props }) {
  const Icon = icon;

  return (
    <div className="relative">
      <input
        {...props}
        className={`${Icon && "pl-9"} ${className} ${inputClass(error)}`}
      />

      {Icon && (
        <Icon
          size={16}
          className="absolute top-1/2 -translate-y-1/2 left-3"
          color="#717781"
        />
      )}
    </div>
  );
}
