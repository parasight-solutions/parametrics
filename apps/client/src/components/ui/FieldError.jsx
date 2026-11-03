const variants = {
  red: "text-red-600",
  white: "text-white",
};

export default function FieldError({ variant = "red", className, error }) {
  return (
    error && (
      <p className={`${className} text-xs ${variants[variant]}`}>{error}</p>
    )
  );
}
