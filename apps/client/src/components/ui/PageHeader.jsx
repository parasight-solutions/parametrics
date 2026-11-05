export default function PageHeader({ heading, subHeading, children }) {
  return (
    <div
      className="flex flex-col md:flex-row
      justify-between md:items-center
      gap-6 md:gap-0"
    >
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-2xl text-[#191C1E]">{heading}</div>

        {subHeading && (
          <div className="font-medium text-xs text-[#585F67]">{subHeading}</div>
        )}
      </div>

      {children}
    </div>
  );
}
