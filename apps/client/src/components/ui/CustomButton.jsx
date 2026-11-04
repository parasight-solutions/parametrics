import { Loader2 } from "lucide-react";

const variants = {
  orange: {
    text_color: "text-white",
    bg_color: "bg-[#7851A9] hover:bg-[#66448f]",
    border: "border border-transparent",
  },
  orange_white: {
    text_color: "text-[#7851A9]",
    bg_color: "bg-white hover:bg-[#FFF8EF]",
    border: "border border-[#7851A9]",
  },
  white: {
    text_color: "text-gray-800",
    bg_color: "bg-white hover:bg-gray-100",
    border: "border border-gray-300",
  },
  red: {
    text_color: "text-white",
    bg_color: "bg-[#BA1A1A] hover:bg-[#A71717]",
    border: "border border-transparent",
  },
  red_white: {
    text_color: "text-[#BA1A1A]",
    bg_color: "bg-white hover:bg-[#FFDAD6]",
    border: "border border-[#BA1A1A]",
  },
};

const size = {
  mid: {
    text: "text-sm",
    icon: 16,
  },
  small: {
    text: "text-xs",
    icon: 14,
  },
};

export default function CustomButton({
  icon,
  iconClassName = "",
  className = "",
  name,
  variant = "orange",
  sizeVariant = "mid",
  loading,
  disabled,
  ...props
}) {
  const Icon = loading ? Loader2 : icon;

  return (
    <button
      {...props}
      className={`${className} ${size[sizeVariant].text} ${variants[variant]?.text_color} ${variants[variant]?.bg_color} ${variants[variant]?.border}
      shrink-0 px-4 py-1.5 flex items-center justify-center gap-2 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-all`}
      disabled={loading || disabled}
    >
      {Icon && (
        <Icon
          size={size[sizeVariant].icon}
          className={`shrink-0 ${loading ? "animate-spin" : iconClassName}`}
        />
      )}

      {name}
    </button>
  );
}
