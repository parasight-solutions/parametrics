const variants = {
  gray: { bg_color: "bg-[#585F67] hover:bg-gray-800" },
  purple: { bg_color: "bg-[#7851A9] hover:bg-[#66448f]" },
  green: { bg_color: "bg-green-600 hover:bg-green-700" },
  red: { bg_color: "bg-[#BA1A1A] hover:bg-[#A71717]" },
  custom: "",
};

export default function ActionButton({
  icon,
  className = "",
  size = 18,
  variant = "gray",
  iconClass = "",
  ...props
}) {
  const Icon = icon;

  return (
    <button
      {...props}
      className={`w-fit ${className} ${variants[variant].bg_color} p-1 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all`}
    >
      <Icon size={size} className={`shrink-0 text-white ${iconClass}`} />
    </button>
  );
}
