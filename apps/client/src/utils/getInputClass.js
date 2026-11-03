export const inputClass = (error) => {
  return `w-full px-3 py-2 outline-none text-sm text-black placeholder:text-[#C1C7D1] bg-[#F7F9FB] border rounded-md disabled:opacity-60 disabled:cursor-not-allowed
  ${error ? `border-red-400` : `border border-[#C3C6D7] focus:border-transparent focus:ring ring-[#EC6C2D]`}`;
};
