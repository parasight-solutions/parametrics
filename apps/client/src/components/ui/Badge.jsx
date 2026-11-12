const BADGE_COLORS = {
  purple: { text_color: "text-[#7851A9]", bg_color: "bg-[#66448f]" },
  green: { text_color: "text-[#059669]", bg_color: "bg-[#ECFDF5]" },
  gray: { text_color: "text-[#475569]", bg_color: "bg-[#F1F5F9]" },
  red: { text_color: "text-[#93000A]", bg_color: "bg-[#FFDAD6]" },
  yellow: { text_color: "text-[#A16207]", bg_color: "bg-[#FEFCE8]" },
  blue: {
    text_color: "text-[#1D4ED8]",
    bg_color: "bg-[#DBEAFE]",
  },
};

export default function Badge({ variant = "gray", text, className = "" }) {
  const styles = BADGE_COLORS[variant];

  return (
    <div
      className={`shrink-0 px-2 py-0.5 w-fit
      font-medium text-center text-[10px] leading-3.5
      ${className} ${styles?.text_color} uppercase ${styles?.bg_color} border rounded-full`}
    >
      {text}
    </div>
  );
}
