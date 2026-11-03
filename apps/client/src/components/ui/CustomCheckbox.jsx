export default function CustomCheckbox({ ...props }) {
  return (
    <input
      {...props}
      type="checkbox"
      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
