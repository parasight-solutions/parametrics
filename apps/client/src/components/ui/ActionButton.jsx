const variants = {
  gray: "text-[#585F67] hover:text-gray-800",
  purple: "text-[#7851A9] hover:text-[#66448f]",
  green: "text-green-600 hover:text-green-700",
  red: "text-[#BA1A1A] hover:text-[#A71717]",
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
      className={`${className} p-1 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all`}
    >
      <Icon size={size} className={`${iconClass} ${variants[variant]}`} />
    </button>
  );
}
