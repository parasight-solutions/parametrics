import { inputClass } from "../../utils/getInputClass";

export default function CustomTextarea({ icon, error, className, ...props }) {
  const Icon = icon;

  return (
    <div className="relative">
      <textarea
        {...props}
        className={`${Icon && "pl-12"} ${className} ${inputClass(error)}`}
      />

      {Icon && (
        <Icon
          size={18}
          className="absolute top-1/2 -translate-y-1/2 left-4"
          color="#717781"
        />
      )}
    </div>
  );
}
